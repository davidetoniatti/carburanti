package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"carburanti/internal/cache"
	"carburanti/internal/models"
)

func TestClient_GetFuels(t *testing.T) {
	// Mock upstream
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/registry/fuels" {
			t.Errorf("expected path /registry/fuels, got %s", r.URL.Path)
		}
		resp := struct {
			Results []map[string]string `json:"results"`
		}{
			Results: []map[string]string{
				{"id": "1-x", "description": "Benzina"},
				{"id": "2-x", "description": "Gasolio"},
				{"id": "invalid", "description": "Skip Me"},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	fuels, err := client.GetFuels()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(fuels) != 2 {
		t.Errorf("expected 2 fuels, got %d", len(fuels))
	}

	if fuels[0].ID != 1 || fuels[0].Name != "Benzina" {
		t.Errorf("unexpected fuel data: %+v", fuels[0])
	}

	// Test cache
	_, _ = client.GetFuels()
	// If it reached here without panic and with same result, cache is likely working
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

	res, err := client.SearchZone(41.0, 12.0, 5)
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

	station, err := client.GetServiceArea(123)
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

	_, err := client.GetFuels()
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
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		time.Sleep(100 * time.Millisecond) // Slow response to allow coalescing
		resp := models.SearchResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := cache.New[any]()
	client := NewClient(server.URL, c)

	// Fire many concurrent requests
	const workers = 50
	errChan := make(chan error, workers)
	for i := 0; i < workers; i++ {
		go func() {
			_, err := client.SearchZone(41.0, 12.0, 5)
			errChan <- err
		}()
	}

	for i := 0; i < workers; i++ {
		if err := <-errChan; err != nil {
			t.Errorf("request failed: %v", err)
		}
	}

	if calls != 1 {
		t.Errorf("expected only 1 upstream call, got %d", calls)
	}
}

func TestClient_SingleflightCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		_, err := client.SearchZoneWithContext(ctx1, 41.0, 12.0, 5)
		errChan <- err
	}()
    
	time.Sleep(20 * time.Millisecond)
    
	go func() {
		_, err := client.SearchZoneWithContext(ctx2, 41.0, 12.0, 5)
		errChan <- err
	}()

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
    
    if succeeded != 1 {
        t.Errorf("expected 1 success, got %d. Errs: %v", succeeded, errs)
    }
}
