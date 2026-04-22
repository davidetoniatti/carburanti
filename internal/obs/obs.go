// Package obs provides a tiny per-request timing tracker for upstream calls.
// The logging middleware installs a Timing into the request context; clients
// record the duration of each upstream HTTP round-trip; the middleware reads
// the aggregate and emits it alongside the total request duration.
package obs

import (
	"context"
	"sync"
	"time"
)

type ctxKey struct{}

// Timing accumulates upstream call durations for one request. Safe for
// concurrent use — singleflight and handler goroutines may both record.
type Timing struct {
	mu       sync.Mutex
	upstream time.Duration
	calls    int
}

// Add records one upstream call of duration d.
func (t *Timing) Add(d time.Duration) {
	t.mu.Lock()
	t.upstream += d
	t.calls++
	t.mu.Unlock()
}

// Snapshot returns the accumulated upstream duration and call count.
func (t *Timing) Snapshot() (time.Duration, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.upstream, t.calls
}

// WithTiming attaches a fresh Timing to ctx and returns both. The returned
// Timing should be read after the handler returns.
func WithTiming(ctx context.Context) (context.Context, *Timing) {
	t := &Timing{}
	return context.WithValue(ctx, ctxKey{}, t), t
}

// Record adds d to the Timing attached to ctx, if any. Safe to call with a
// context that has no Timing — the call is a no-op.
func Record(ctx context.Context, d time.Duration) {
	if t, ok := ctx.Value(ctxKey{}).(*Timing); ok && t != nil {
		t.Add(d)
	}
}
