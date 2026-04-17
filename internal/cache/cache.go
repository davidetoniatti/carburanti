package cache

import (
	"container/list"
	"sync"
	"time"
)

const DefaultMaxSize = 10_000

type item[T any] struct {
	key        string
	value      T
	expiration int64
	element    *list.Element
}

type Cache[T any] struct {
	items   map[string]*item[T]
	lru     *list.List
	maxSize int
	mu      sync.Mutex
	stopCh  chan struct{}
	once    sync.Once
}

func New[T any]() *Cache[T] {
	return NewWithSize[T](DefaultMaxSize)
}

func NewWithSize[T any](maxSize int) *Cache[T] {
	if maxSize <= 0 {
		maxSize = DefaultMaxSize
	}
	c := &Cache[T]{
		items:   make(map[string]*item[T]),
		lru:     list.New(),
		maxSize: maxSize,
		stopCh:  make(chan struct{}),
	}
	go c.janitor()
	return c
}

func (c *Cache[T]) Set(key string, value T, duration time.Duration) {
	var expiration int64
	if duration > 0 {
		expiration = time.Now().Add(duration).UnixNano()
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.items[key]; ok {
		existing.value = value
		existing.expiration = expiration
		c.lru.MoveToFront(existing.element)
		return
	}

	it := &item[T]{key: key, value: value, expiration: expiration}
	it.element = c.lru.PushFront(it)
	c.items[key] = it

	if c.lru.Len() > c.maxSize {
		c.evictOldest()
	}
}

func (c *Cache[T]) Get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	it, found := c.items[key]
	if !found {
		var zero T
		return zero, false
	}

	if it.expiration > 0 && time.Now().UnixNano() > it.expiration {
		c.removeItem(it)
		var zero T
		return zero, false
	}

	c.lru.MoveToFront(it.element)
	return it.value, true
}

func (c *Cache[T]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lru.Len()
}

func (c *Cache[T]) Stop() {
	c.once.Do(func() {
		close(c.stopCh)
	})
}

func (c *Cache[T]) evictOldest() {
	oldest := c.lru.Back()
	if oldest == nil {
		return
	}
	c.removeItem(oldest.Value.(*item[T]))
}

func (c *Cache[T]) removeItem(it *item[T]) {
	c.lru.Remove(it.element)
	delete(c.items, it.key)
}

func (c *Cache[T]) janitor() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.mu.Lock()
			now := time.Now().UnixNano()
			for e := c.lru.Back(); e != nil; {
				prev := e.Prev()
				it := e.Value.(*item[T])
				if it.expiration > 0 && now > it.expiration {
					c.removeItem(it)
				}
				e = prev
			}
			c.mu.Unlock()
		case <-c.stopCh:
			return
		}
	}
}
