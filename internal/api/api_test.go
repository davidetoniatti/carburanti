package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ohmypieno/internal/cache"
	"ohmypieno/internal/models"
)

func TestClient_GetFuels(t *testing.T) {
	c := cache.New[any]()
	client := NewClient("", c)

	fuels, err := client.GetFuels(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(fuels) != 5 {
		t.Errorf("expected 5 fuels, got %d", len(fuels))
	}

	if fuels[0].ID != 1 || fuels[0].Name != "Benzina" {
		t.Errorf("unexpected fuel data: %+v", fuels[0])
	}
}

func TestClient_SearchZone(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		var req models.SearchRequest
		json.NewDecoder(r.Body).Decode(&req)
		if len(req.Points) == 0 || req.Points[0].Lat != 41.0 {
			t.Errorf("unexpected request body: %+v", req)
		}

		resp := models.SearchResponse{
			Success: true,
			Results: []models.GasStation{
				{ID: 123, Name: "Test Station"},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	res, err := client.SearchZone(context.Background(), 41.0, 12.0, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(res.Results) != 1 || res.Results[0].ID != 123 {
		t.Errorf("unexpected search results: %+v", res.Results)
	}
}

func TestClient_GetServiceArea(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/registry/servicearea/123" {
			t.Errorf("expected path /registry/servicearea/123, got %s", r.URL.Path)
		}
		resp := models.GasStation{
			ID:   123,
			Name: "Detailed Station",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	station, err := client.GetServiceArea(context.Background(), 123)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.ID != 123 || station.Name != "Detailed Station" {
		t.Errorf("unexpected station data: %+v", station)
	}
}

func TestClient_ErrorHandling(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	_, err := client.SearchZone(context.Background(), 0, 0, 100)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestCache_Expiration(t *testing.T) {
	c := cache.New[any]()
	c.Set("key", "value", 100*time.Millisecond)

	val, found := c.Get("key")
	if !found || val != "value" {
		t.Fatal("expected to find value")
	}

	time.Sleep(150 * time.Millisecond)
	_, found = c.Get("key")
	if found {
		t.Fatal("expected value to be expired")
	}
}

func TestClient_SingleflightCoalescing(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		time.Sleep(100 * time.Millisecond) // Slow response to allow coalescing
		resp := models.SearchResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	// Fire many concurrent requests
	const workers = 50
	var wg sync.WaitGroup
	errChan := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := client.SearchZone(context.Background(), 41.0, 12.0, 5)
			errChan <- err
		}()
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		if err != nil {
			t.Errorf("request failed: %v", err)
		}
	}

	if calls.Load() != 1 {
		t.Errorf("expected only 1 upstream call, got %d", calls.Load())
	}
}

func TestClient_SingleflightCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started) // Signal that the first request reached the server
		time.Sleep(100 * time.Millisecond)
		resp := models.SearchResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2 := context.Background()

	errChan := make(chan error, 2)
	go func() {
		_, err := client.SearchZone(ctx1, 41.0, 12.0, 5)
		errChan <- err
	}()

	// Wait for first request to reach server
	select {
	case <-started:
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for request 1 to start")
	}

	go func() {
		_, err := client.SearchZone(ctx2, 41.0, 12.0, 5)
		errChan <- err
	}()

	// Small sleep to ensure second goroutine joined the flight
	time.Sleep(20 * time.Millisecond)
	cancel1()

	var errs []error
	for i := 0; i < 2; i++ {
		errs = append(errs, <-errChan)
	}

	succeeded := 0
	for _, e := range errs {
		if e == nil {
			succeeded++
		}
	}

	if succeeded != 0 {
		t.Errorf("expected 0 successes (all cancelled), got %d. Errs: %v", succeeded, errs)
	}
}
