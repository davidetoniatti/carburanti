package cache

import (
	"fmt"
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
