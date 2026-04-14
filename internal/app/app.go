package app

import (
	"compress/gzip"
	"embed"
	"io"
	"io/fs"
	"log"
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

	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	// Chain middlewares: Gzip -> CORS
	handler := gzipMiddleware(corsMiddleware(mux))

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
	log.Printf("Carburanti server running on http://localhost%s\n", addr)
	return a.server.ListenAndServe()
}

func (a *App) Close() {
	a.cache.Stop()
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type gzipResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w gzipResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		gzw := gzipResponseWriter{Writer: gz, ResponseWriter: w}
		next.ServeHTTP(gzw, r)
	})
}
