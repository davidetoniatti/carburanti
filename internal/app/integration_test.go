package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// fakeStaticFS mimics the production embed.FS shape: a top-level "static"
// directory containing the files the FileServer will serve.
func fakeStaticFS() fstest.MapFS {
	// 1x1 transparent PNG (binary payload; must not be gzipped).
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	}
	return fstest.MapFS{
		"static/hello.txt":  {Data: []byte(strings.Repeat("hello world ", 50))},
		"static/pixel.png":  {Data: png},
		"static/index.html": {Data: []byte("<!doctype html><div id=\"app\"></div>")},
	}
}

func newTestApp(t *testing.T) *App {
	t.Helper()
	cfg := &Config{
		Port:         "0",
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
		IdleTimeout:  2 * time.Second,
		LatMin:       35.0,
		LatMax:       48.0,
		LngMin:       6.0,
		LngMax:       19.0,
		MaxRadius:    50,
	}
	app, err := New(cfg, fakeStaticFS())
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(app.Close)
	return app
}

func doGzipRequest(t *testing.T, h http.Handler, path, remoteAddr string) (*http.Response, []byte) {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	resp := rr.Result()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	resp.Body.Close()

	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("gzip reader: %v", err)
		}
		body, err = io.ReadAll(gz)
		if err != nil {
			t.Fatalf("gunzip: %v", err)
		}
	}
	return resp, body
}

// --- /api/fuels: long cache, gzip, security headers -------------------------

func TestIntegration_FuelsCacheableAndCompressed(t *testing.T) {
	app := newTestApp(t)
	resp, body := doGzipRequest(t, app.Handler(), "/api/fuels", "192.0.2.10:1")

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); got != "public, max-age=86400, immutable" {
		t.Errorf("Cache-Control: %q", got)
	}
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Errorf("expected gzip, got %q", resp.Header.Get("Content-Encoding"))
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing X-Content-Type-Options")
	}
	if resp.Header.Get("X-Frame-Options") != "DENY" {
		t.Errorf("missing X-Frame-Options")
	}
	if resp.Header.Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
		t.Errorf("missing Referrer-Policy")
	}
	if resp.Header.Get("Vary") != "Accept-Encoding" {
		t.Errorf("missing Vary")
	}

	var fuels []map[string]any
	if err := json.Unmarshal(body, &fuels); err != nil {
		t.Fatalf("json: %v (body=%q)", err, body)
	}
	if len(fuels) != 5 {
		t.Errorf("expected 5 fuels, got %d", len(fuels))
	}
}

// --- /api/search validation still works through the full chain --------------

func TestIntegration_SearchValidationPath(t *testing.T) {
	app := newTestApp(t)
	req := httptest.NewRequest("GET", "/api/search?lat=abc&lng=12.0", nil)
	req.RemoteAddr = "192.0.2.11:1"
	rr := httptest.NewRecorder()
	app.Handler().ServeHTTP(rr, req)

	resp := rr.Result()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing security header on 400")
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Errorf("Cache-Control on /api/search error: %q", got)
	}
}

// --- Rate limit 429 must still get security headers -------------------------

func TestIntegration_RateLimit429KeepsSecurityHeaders(t *testing.T) {
	app := newTestApp(t)
	h := app.Handler()

	// Burn through the burst.
	for i := 0; i < apiRateBurst; i++ {
		req := httptest.NewRequest("GET", "/api/fuels", nil)
		req.RemoteAddr = "192.0.2.50:1"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
	}

	req := httptest.NewRequest("GET", "/api/fuels", nil)
	req.RemoteAddr = "192.0.2.50:1"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	resp := rr.Result()

	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("429 missing security header")
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Errorf("429 missing Retry-After")
	}
}

// --- Static assets are not rate limited -------------------------------------

func TestIntegration_StaticNotRateLimited(t *testing.T) {
	app := newTestApp(t)
	h := app.Handler()

	for i := 0; i < apiRateBurst*3; i++ {
		req := httptest.NewRequest("GET", "/hello.txt", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		req.RemoteAddr = "192.0.2.60:1"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("iter %d: got %d", i, rr.Code)
		}
	}
}

// --- Static text file goes through gzip and has long-ish cache --------------

func TestIntegration_StaticCompressibleGzipped(t *testing.T) {
	app := newTestApp(t)
	resp, body := doGzipRequest(t, app.Handler(), "/hello.txt", "192.0.2.61:1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: %d", resp.StatusCode)
	}
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Errorf("expected gzip on text, got %q", resp.Header.Get("Content-Encoding"))
	}
	if !bytes.Contains(body, []byte("hello world")) {
		t.Errorf("body: %q", body)
	}
}

// --- Binary asset (PNG) must NOT be gzipped ---------------------------------

func TestIntegration_StaticBinaryNotGzipped(t *testing.T) {
	app := newTestApp(t)
	req := httptest.NewRequest("GET", "/pixel.png", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.RemoteAddr = "192.0.2.70:1"
	rr := httptest.NewRecorder()
	app.Handler().ServeHTTP(rr, req)
	resp := rr.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: %d", resp.StatusCode)
	}
	if resp.Header.Get("Content-Encoding") == "gzip" {
		t.Errorf("PNG should not be gzipped")
	}
	if resp.Header.Get("Content-Type") == "" ||
		!strings.HasPrefix(resp.Header.Get("Content-Type"), "image/") {
		t.Errorf("unexpected Content-Type for PNG: %q", resp.Header.Get("Content-Type"))
	}
}

// --- Gzip concurrent traffic exercises the sync.Pool ------------------------

func TestIntegration_GzipConcurrent(t *testing.T) {
	h := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, strings.Repeat(`{"k":"v"}`, 200))
	}))

	const N = 100
	var wg sync.WaitGroup
	errs := make(chan error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest("GET", "/", nil)
			req.Header.Set("Accept-Encoding", "gzip")
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if rr.Header().Get("Content-Encoding") != "gzip" {
				errs <- nil
				return
			}
			gz, err := gzip.NewReader(rr.Body)
			if err != nil {
				errs <- err
				return
			}
			if _, err := io.ReadAll(gz); err != nil {
				errs <- err
				return
			}
			errs <- nil
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent gzip: %v", err)
		}
	}
}

// --- Empty response with no Content-Type must not be gzipped ----------------

func TestIntegration_GzipEmptyBodyNoContentType(t *testing.T) {
	h := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("status: %d", rr.Code)
	}
	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Errorf("empty 204 must not be gzipped (got Content-Encoding: %q)",
			rr.Header().Get("Content-Encoding"))
	}
	if rr.Body.Len() != 0 {
		t.Errorf("empty 204 body got %d bytes", rr.Body.Len())
	}
}

// --- Pre-encoded body passes through untouched ------------------------------

func TestIntegration_GzipSkipsAlreadyEncoded(t *testing.T) {
	h := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("\x1f\x8b"))
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Errorf("Content-Encoding: %q", rr.Header().Get("Content-Encoding"))
	}
	if !bytes.Equal(rr.Body.Bytes(), []byte("\x1f\x8b")) {
		t.Errorf("body should be untouched, got %q", rr.Body.String())
	}
}
