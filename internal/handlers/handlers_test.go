package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"carburanti/internal/models"
)

type mockStationProvider struct {
	searchFunc  func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error)
	fuelsFunc   func(ctx context.Context) ([]models.FuelType, error)
	detailFunc  func(ctx context.Context, id int) (*models.GasStation, error)
	geocodeFunc func(ctx context.Context, query, lang string) (any, error)
}

func (m *mockStationProvider) SearchZone(lat, lng float64, radius int) (*models.SearchResponse, error) {
	return m.searchFunc(context.Background(), lat, lng, radius)
}
func (m *mockStationProvider) SearchZoneWithContext(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
	return m.searchFunc(ctx, lat, lng, radius)
}
func (m *mockStationProvider) GetFuels() ([]models.FuelType, error) {
	return m.fuelsFunc(context.Background())
}
func (m *mockStationProvider) GetFuelsWithContext(ctx context.Context) ([]models.FuelType, error) {
	return m.fuelsFunc(ctx)
}
func (m *mockStationProvider) GetServiceArea(id int) (*models.GasStation, error) {
	return m.detailFunc(context.Background(), id)
}
func (m *mockStationProvider) GetServiceAreaWithContext(ctx context.Context, id int) (*models.GasStation, error) {
	return m.detailFunc(ctx, id)
}
func (m *mockStationProvider) GeocodeWithContext(ctx context.Context, query, lang string) (any, error) {
	if m.geocodeFunc == nil {
		return []any{}, nil
	}
	return m.geocodeFunc(ctx, query, lang)
}

func TestSearchHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return &models.SearchResponse{
				Success: true,
				Results: []models.GasStation{
					{
						ID: 1, Name: "Test Station",
						Fuels: []models.Fuel{
							{FuelID: 1, Price: 1.5, IsSelf: true},
							{FuelID: 1, Price: 1.8, IsSelf: false},
						},
					},
				},
			}, nil
		},
	}
	srv := NewServer(mock, mock)

	t.Run("Valid Search with Rules", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=1&mode=self", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}

		var res models.SearchResponse
		json.NewDecoder(rr.Body).Decode(&res)

		if len(res.Results) != 1 {
			t.Fatal("expected 1 result")
		}
		// Verify business rules applied
		if res.Results[0].SelectedPrice != 1.5 {
			t.Errorf("expected price 1.5, got %f", res.Results[0].SelectedPrice)
		}
	})

	t.Run("Invalid Method", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/search", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)

		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected 405, got %d", rr.Code)
		}
	})

	t.Run("Out of Range Lat", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/search?lat=90&lng=0", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("Upstream Failure", func(t *testing.T) {
		mock.searchFunc = func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return nil, errors.New("boom")
		}
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)

		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}
		var errRes map[string]string
		json.NewDecoder(rr.Body).Decode(&errRes)
		if errRes["error"] != "upstream service error" {
			t.Errorf("expected safe error message, got %s", errRes["error"])
		}
	})

	t.Run("Radius Too Large", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&radius=100", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("Invalid Mode", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&mode=invalid", nil)
		rr := httptest.NewRecorder()
		srv.SearchHandler(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}
	})
}

func TestSearchHandler_CacheMutationReproduction(t *testing.T) {
	// Simulate a shared response that would come from a cache
	sharedResponse := &models.SearchResponse{
		Results: []models.GasStation{
			{
				ID: 1, Name: "Test Station",
				Fuels: []models.Fuel{
					{FuelID: 1, Price: 1.5, Name: "Benzina", IsSelf: true},
					{FuelID: 2, Price: 1.8, Name: "Gasolio", IsSelf: true},
				},
			},
		},
	}

	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return sharedResponse, nil
		},
	}
	srv := NewServer(mock, mock)

	// First request for FuelID 1
	req1 := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=1&mode=self", nil)
	rr1 := httptest.NewRecorder()
	srv.SearchHandler(rr1, req1)

	var res1 models.SearchResponse
	json.NewDecoder(rr1.Body).Decode(&res1)
	if res1.Results[0].SelectedFuelName != "Benzina" {
		t.Errorf("Expected Benzina, got %s", res1.Results[0].SelectedFuelName)
	}

	// Second request for FuelID 2
	req2 := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=2&mode=self", nil)
	rr2 := httptest.NewRecorder()
	srv.SearchHandler(rr2, req2)

	var res2 models.SearchResponse
	json.NewDecoder(rr2.Body).Decode(&res2)
	if res2.Results[0].SelectedFuelName != "Gasolio" {
		t.Errorf("Expected Gasolio, got %s", res2.Results[0].SelectedFuelName)
	}

	// CHECK LEAKAGE: If we re-examine res1, it might have been mutated if the underlying
	// sharedResponse was modified and res1 was just a reference to it.
	// But in SearchHandler, it returns the same pointer it got from the client.

	if sharedResponse.Results[0].SelectedFuelName == "Gasolio" {
		t.Errorf("BUG REPRODUCED: Shared response was mutated! It now has %s", sharedResponse.Results[0].SelectedFuelName)
	}
}

func TestSearchHandler_Concurrency(t *testing.T) {
	sharedResponse := &models.SearchResponse{
		Results: []models.GasStation{
			{
				ID: 1, Name: "Station 1",
				Fuels: []models.Fuel{
					{FuelID: 1, Price: 1.0, Name: "F1", IsSelf: true},
					{FuelID: 2, Price: 2.0, Name: "F2", IsSelf: true},
				},
			},
		},
	}
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return sharedResponse, nil
		},
	}
	srv := NewServer(mock, mock)

	const workers = 20
	errChan := make(chan error, workers)

	for i := 0; i < workers; i++ {
		fuelID := (i % 2) + 1 // alternates between 1 and 2
		expectedName := fmt.Sprintf("F%d", fuelID)

		go func(fid int, name string) {
			path := fmt.Sprintf("/api/search?lat=41.0&lng=12.0&fuel=%d&mode=self", fid)
			req := httptest.NewRequest("GET", path, nil)
			rr := httptest.NewRecorder()
			srv.SearchHandler(rr, req)

			if rr.Code != http.StatusOK {
				errChan <- fmt.Errorf("got status %d", rr.Code)
				return
			}

			var res models.SearchResponse
			json.NewDecoder(rr.Body).Decode(&res)
			if res.Results[0].SelectedFuelName != name {
				errChan <- fmt.Errorf("expected %s, got %s", name, res.Results[0].SelectedFuelName)
				return
			}
			errChan <- nil
		}(fuelID, expectedName)
	}

	for i := 0; i < workers; i++ {
		if err := <-errChan; err != nil {
			t.Error(err)
		}
	}
}

func TestGeocodeHandler(t *testing.T) {
	mock := &mockStationProvider{
		geocodeFunc: func(ctx context.Context, query, lang string) (any, error) {
			if query == "error" {
				return nil, errors.New("boom")
			}
			return []map[string]string{{"name": "Roma"}}, nil
		},
	}
	srv := NewServer(mock, mock)

	t.Run("Success", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/geocode?q=roma", nil)
		rr := httptest.NewRecorder()
		srv.GeocodeHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
		if rr.Header().Get("Content-Type") != "application/json" {
			t.Errorf("expected application/json, got %s", rr.Header().Get("Content-Type"))
		}
	})

	t.Run("Missing Query", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/geocode", nil)
		rr := httptest.NewRecorder()
		srv.GeocodeHandler(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("Service Error", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/geocode?q=error", nil)
		rr := httptest.NewRecorder()
		srv.GeocodeHandler(rr, req)
		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}
	})
}

func TestStationHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{
		detailFunc: func(ctx context.Context, id int) (*models.GasStation, error) {
			return &models.GasStation{ID: id, Name: "Details"}, nil
		},
	}
	srv := NewServer(mock, mock)

	t.Run("Valid ID", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/station?id=123", nil)
		rr := httptest.NewRecorder()
		srv.StationHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}
		if rr.Header().Get("Content-Type") != "application/json" {
			t.Errorf("expected application/json, got %s", rr.Header().Get("Content-Type"))
		}
		var s models.GasStation
		json.NewDecoder(rr.Body).Decode(&s)
		if s.ID != 123 {
			t.Errorf("expected ID 123, got %d", s.ID)
		}
	})

	t.Run("Invalid ID", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/station?id=-1", nil)
		rr := httptest.NewRecorder()
		srv.StationHandler(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}
	})
}
