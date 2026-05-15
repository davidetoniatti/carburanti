package app

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	apiRatePerSec   = 20
	apiRateBurst    = 40
	limiterIdleTTL  = 10 * time.Minute
	cleanupInterval = 2 * time.Minute

	// Nominatim ToS requires no more than 1 req/s. We use a global bucket
	// to ensure our server IP stays within limits regardless of user count.
	geocodeRatePerSec = 1
	geocodeRateBurst  = 2
)

type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type rateLimiter struct {
	mu         sync.Mutex
	limiters   map[string]*ipLimiter
	trustProxy bool
	stopCh     chan struct{}
	once       sync.Once

	globalGeocode *rate.Limiter
}

func newRateLimiter(trustProxy bool) *rateLimiter {
	rl := &rateLimiter{
		limiters:      make(map[string]*ipLimiter),
		trustProxy:    trustProxy,
		stopCh:        make(chan struct{}),
		globalGeocode: rate.NewLimiter(rate.Limit(geocodeRatePerSec), geocodeRateBurst),
	}
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) stop() {
	rl.once.Do(func() { close(rl.stopCh) })
}

func (rl *rateLimiter) allow(key string, isGeocode bool) bool {
	if isGeocode {
		if !rl.globalGeocode.Allow() {
			return false
		}
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, ok := rl.limiters[key]
	if !ok {
		entry = &ipLimiter{limiter: rate.NewLimiter(apiRatePerSec, apiRateBurst)}
		rl.limiters[key] = entry
	}
	entry.lastSeen = time.Now()
	return entry.limiter.Allow()
}

func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			cutoff := time.Now().Add(-limiterIdleTTL)
			rl.mu.Lock()
			for k, v := range rl.limiters {
				if v.lastSeen.Before(cutoff) {
					delete(rl.limiters, k)
				}
			}
			rl.mu.Unlock()
		case <-rl.stopCh:
			return
		}
	}
}

func (rl *rateLimiter) clientKey(r *http.Request) string {
	if rl.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Left-most entry is the original client.
			if i := strings.IndexByte(xff, ','); i >= 0 {
				return strings.TrimSpace(xff[:i])
			}
			return strings.TrimSpace(xff)
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return strings.TrimSpace(xr)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		isGeocode := r.URL.Path == "/api/geocode"
		if !rl.allow(rl.clientKey(r), isGeocode) {
			h := w.Header()
			h.Set("Content-Type", "application/json")
			h.Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
