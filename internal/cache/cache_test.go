package cache

import (
	"testing"
	"time"
)

func TestCache_StopSafety(t *testing.T) {
	c := New[any]()
	c.Stop()
	// This should not panic
	c.Stop()
}

func TestCache_GetDeletesExpired(t *testing.T) {
	c := New[string]()
	c.Set("key", "value", 1*time.Millisecond)
	time.Sleep(2 * time.Millisecond)

	_, found := c.Get("key")
	if found {
		t.Error("expected item to be expired")
	}

	// Verify it was deleted from internal map
	c.mu.RLock()
	defer c.mu.RUnlock()
	if _, found := c.items["key"]; found {
		t.Error("expected item to be deleted from map after Get")
	}
}
