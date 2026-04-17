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

	"ohmypieno/internal/api"
	"ohmypieno/internal/cache"
	"ohmypieno/internal/handlers"
)

type App struct {
	server      *http.Server
	cache       *cache.Cache[any]
	rateLimiter *rateLimiter
}

func New(cfg *Config, staticFiles embed.FS) (*App, error) {
	c := cache.New[any]()
	apiClient := api.NewClient(cfg.BaseURL, c)
	geocodeClient := api.NewNominatimClient(c)
	h := handlers.NewServer(apiClient, geocodeClient)
	h.Config.LatMin = cfg.LatMin
	h.Config.LatMax = cfg.LatMax
	h.Config.LngMin = cfg.LngMin
	h.Config.LngMax = cfg.LngMax
	h.Config.MaxRadius = cfg.MaxRadius

	mux := http.NewServeMux()
	mux.Handle("/api/search", h.ValidateSearchMiddleware(http.HandlerFunc(h.SearchHandler)))
	mux.HandleFunc("/api/station", h.StationHandler)
	mux.HandleFunc("/api/fuels", h.FuelsHandler)
	mux.HandleFunc("/api/geocode", h.GeocodeHandler)

	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	rl := newRateLimiter(cfg.TrustProxyHeaders)

	// Chain middlewares: Logging -> SecurityHeaders -> Gzip -> RateLimit -> Cache-Control
	handler := loggingMiddleware(securityHeadersMiddleware(gzipMiddleware(rl.middleware(cacheControlMiddleware(mux)))))

	srv := &http.Server{
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	return &App{
		server:      srv,
		cache:       c,
		rateLimiter: rl,
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
	a.rateLimiter.stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request handled",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start))
	})
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cacheControlMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/fuels":
			// Hardcoded constant, safe to cache for a day.
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		case strings.HasPrefix(r.URL.Path, "/api/"):
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
		case r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html"):
			w.Header().Set("Cache-Control", "no-cache")
		case strings.Contains(r.URL.Path, "/js/") || strings.Contains(r.URL.Path, "/css/"):
			w.Header().Set("Cache-Control", "public, max-age=3600")
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
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") ||
			r.Header.Get("Sec-WebSocket-Key") != "" {
			next.ServeHTTP(w, r)
			return
		}

		// Don't compress if already compressed or if it's an image/media
		// This is a simple check, could be more exhaustive
		if w.Header().Get("Content-Encoding") != "" {
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
