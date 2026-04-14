package main

import (
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"carburanti/internal/app"
)

func TestSmoke_FullApp(t *testing.T) {
	// Set up a full app instance
	baseURL := os.Getenv("CARBURANTI_API_URL")
	if baseURL == "" {
		baseURL = "https://carburanti.mise.gov.it/ospzApi"
	}

	application, err := app.New(baseURL, staticFiles)
	if err != nil {
		t.Fatalf("failed to create app: %v", err)
	}
	defer application.Close()

	// Start it in a goroutine
	port := ":9999"
	go func() {
		_ = application.Run(port)
	}()

	// Wait for start
	time.Sleep(100 * time.Millisecond)

	// Test 1: Frontend serving
	resp, err := http.Get("http://localhost:9999/")
	if err != nil {
		t.Fatalf("failed to fetch index: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for index, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !contains(string(body), "<div id=\"app\">") {
		t.Error("index.html doesn't contain expected app div")
	}

	// Test 2: API serving
	resp2, err := http.Get("http://localhost:9999/api/fuels")
	if err != nil {
		t.Fatalf("failed to fetch fuels: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for fuels, got %d", resp2.StatusCode)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && func() bool {
		for i := 0; i <= len(s)-len(substr); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	}()
}
