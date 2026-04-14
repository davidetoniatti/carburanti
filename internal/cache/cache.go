package cache

import (
	"sync"
	"time"
)

type item[T any] struct {
	value      T
	expiration int64
}

type Cache[T any] struct {
	items  map[string]item[T]
	mu     sync.RWMutex
	stopCh chan struct{}
	once   sync.Once
}

func New[T any]() *Cache[T] {
	c := &Cache[T]{
		items:  make(map[string]item[T]),
		stopCh: make(chan struct{}),
	}
	go c.janitor()
	return c
}

func (c *Cache[T]) Set(key string, value T, duration time.Duration) {
	var expiration int64
	if duration > 0 {
		expiration = time.Now().UnixNano() + duration.Nanoseconds()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = item[T]{
		value:      value,
		expiration: expiration,
	}
}

func (c *Cache[T]) Get(key string) (T, bool) {
	c.mu.RLock()
	it, found := c.items[key]
	if !found {
		c.mu.RUnlock()
		var zero T
		return zero, false
	}
	if it.expiration > 0 && time.Now().UnixNano() > it.expiration {
		c.mu.RUnlock()
		c.mu.Lock()
		defer c.mu.Unlock()
		// Double check after lock
		it, found = c.items[key]
		if found && it.expiration > 0 && time.Now().UnixNano() > it.expiration {
			delete(c.items, key)
		}
		var zero T
		return zero, false
	}
	c.mu.RUnlock()
	return it.value, true
}

func (c *Cache[T]) Stop() {
	c.once.Do(func() {
		close(c.stopCh)
	})
}

func (c *Cache[T]) janitor() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.mu.Lock()
			now := time.Now().UnixNano()
			for k, v := range c.items {
				if v.expiration > 0 && now > v.expiration {
					delete(c.items, k)
				}
			}
			c.mu.Unlock()
		case <-c.stopCh:
			return
		}
	}
}
