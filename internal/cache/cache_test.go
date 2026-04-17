package cache

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCache_StopSafety(t *testing.T) {
	c := New[any]()
	c.Stop()
	// This should not panic
	c.Stop()
}

func TestCache_GetExpiredReturnsFalse(t *testing.T) {
	c := New[string]()
	c.Set("key", "value", 1*time.Millisecond)
	time.Sleep(2 * time.Millisecond)

	_, found := c.Get("key")
	if found {
		t.Error("expected item to be expired")
	}
}

func TestCache_LRUEviction(t *testing.T) {
	c := NewWithSize[int](3)

	c.Set("a", 1, time.Hour)
	c.Set("b", 2, time.Hour)
	c.Set("c", 3, time.Hour)

	// Touch "a" so it becomes most-recently-used
	if _, ok := c.Get("a"); !ok {
		t.Fatal("expected a")
	}

	// Inserting "d" should evict "b" (now LRU)
	c.Set("d", 4, time.Hour)

	if _, ok := c.Get("b"); ok {
		t.Error("expected b to be evicted")
	}
	if _, ok := c.Get("a"); !ok {
		t.Error("expected a to remain")
	}
	if _, ok := c.Get("c"); !ok {
		t.Error("expected c to remain")
	}
	if _, ok := c.Get("d"); !ok {
		t.Error("expected d to be present")
	}

	if c.Len() != 3 {
		t.Errorf("expected len 3, got %d", c.Len())
	}
}

func TestCache_UpdateExistingDoesNotEvict(t *testing.T) {
	c := NewWithSize[int](2)
	c.Set("a", 1, time.Hour)
	c.Set("b", 2, time.Hour)

	// Re-setting existing key must not push over capacity
	c.Set("a", 10, time.Hour)

	if _, ok := c.Get("a"); !ok {
		t.Error("expected a")
	}
	if _, ok := c.Get("b"); !ok {
		t.Error("expected b")
	}
	if c.Len() != 2 {
		t.Errorf("expected len 2, got %d", c.Len())
	}
}

func TestCache_FillPastCapacity(t *testing.T) {
	const cap = 50
	c := NewWithSize[int](cap)
	for i := 0; i < cap*3; i++ {
		c.Set(fmt.Sprintf("k%d", i), i, time.Hour)
	}
	if c.Len() != cap {
		t.Errorf("expected len %d, got %d", cap, c.Len())
	}
}

func TestCache_ExpiredGetFreesSlot(t *testing.T) {
	// An item whose TTL has elapsed should be removed on Get so new inserts
	// don't trigger LRU eviction of still-valid entries.
	c := NewWithSize[int](2)
	c.Set("a", 1, 1*time.Millisecond)
	c.Set("b", 2, time.Hour)
	time.Sleep(5 * time.Millisecond)

	if _, ok := c.Get("a"); ok {
		t.Fatal("a should be expired")
	}
	if c.Len() != 1 {
		t.Errorf("expected len 1 after lazy eviction, got %d", c.Len())
	}

	// Can add a new entry without evicting "b".
	c.Set("c", 3, time.Hour)
	if _, ok := c.Get("b"); !ok {
		t.Error("b should still be present")
	}
	if _, ok := c.Get("c"); !ok {
		t.Error("c should be present")
	}
}

func TestCache_ConcurrentSetGet(t *testing.T) {
	c := NewWithSize[int](128)
	defer c.Stop()

	const workers = 32
	const iters = 500

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				key := fmt.Sprintf("w%d-k%d", w, i%16)
				c.Set(key, i, time.Hour)
				c.Get(key)
			}
		}(w)
	}
	wg.Wait()

	// Exact length depends on interleaving; just confirm we're within cap.
	if c.Len() > 128 {
		t.Errorf("len %d exceeds cap 128", c.Len())
	}
}
