package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ohmypieno/internal/app"
)

func TestSmoke_FullApp(t *testing.T) {
	// Set up a mock upstream to avoid hitting the real network
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/registry/fuels" {
			resp := struct {
				Results []map[string]string `json:"results"`
			}{
				Results: []map[string]string{
					{"id": "1-x", "description": "Benzina"},
				},
			}
			json.NewEncoder(w).Encode(resp)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mockUpstream.Close()

	// Set up a full app instance
	baseURL := os.Getenv("OHMYPIENO_API_URL")
	if baseURL == "" {
		baseURL = mockUpstream.URL
	}

	application, err := app.New(baseURL, staticFiles)
	if err != nil {
		t.Fatalf("failed to create app: %v", err)
	}
	defer application.Close()

	// Use httptest.NewServer to start the app on an ephemeral port
	ts := httptest.NewServer(application.Handler())
	defer ts.Close()

	// Frontend serving
	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("failed to fetch index: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for index, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "<div id=\"app\">") {
		t.Error("index.html doesn't contain expected app div")
	}

	// API serving
	resp2, err := http.Get(ts.URL + "/api/fuels")
	if err != nil {
		t.Fatalf("failed to fetch fuels: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for fuels, got %d", resp2.StatusCode)
	}
	var fuels []map[string]any
	json.NewDecoder(resp2.Body).Decode(&fuels)
	if len(fuels) != 5 {
		t.Errorf("expected 5 fuels, got %d", len(fuels))
	}
}
