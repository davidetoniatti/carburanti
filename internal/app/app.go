package app

import (
	"compress/gzip"
	"context"
	"embed"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"carburanti/internal/api"
	"carburanti/internal/cache"
	"carburanti/internal/handlers"
)

type App struct {
	server *http.Server
	cache  *cache.Cache[any]
}

func New(baseURL string, staticFiles embed.FS) (*App, error) {
	c := cache.New[any]()
	apiClient := api.NewClient(baseURL, c)
	h := handlers.NewServer(apiClient)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/search", h.SearchHandler)
	mux.HandleFunc("/api/station", h.StationHandler)
	mux.HandleFunc("/api/fuels", h.FuelsHandler)
	mux.HandleFunc("/api/geocode", h.GeocodeHandler)

	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	// Chain middlewares: Gzip -> Cache-Control
	handler := gzipMiddleware(cacheControlMiddleware(mux))

	srv := &http.Server{
		Handler:      handler,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	return &App{
		server: srv,
		cache:  c,
	}, nil
}

func (a *App) Run(addr string) error {
	a.server.Addr = addr
	slog.Info("server starting", "addr", addr)
	return a.server.ListenAndServe()
}

func (a *App) Handler() http.Handler {
	return a.server.Handler
}

func (a *App) Close() {
	a.cache.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}

func cacheControlMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
		} else if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		} else if strings.Contains(r.URL.Path, "/js/") || strings.Contains(r.URL.Path, "/css/") {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		
		next.ServeHTTP(w, r)
		
		slog.Info("request handled", 
			"method", r.Method, 
			"path", r.URL.Path, 
			"duration", time.Since(start))
	})
}

type gzipResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w gzipResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func (w gzipResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		if gz, ok := w.Writer.(*gzip.Writer); ok {
			gz.Flush()
		}
		f.Flush()
	}
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Vary", "Accept-Encoding")
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		gzw := gzipResponseWriter{Writer: gz, ResponseWriter: w}
		next.ServeHTTP(gzw, r)
	})
}
