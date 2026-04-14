package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"carburanti/internal/models"
)

type mockStationProvider struct {
	searchFunc func(lat, lng float64, radius int) (*models.SearchResponse, error)
	fuelsFunc  func() ([]models.FuelType, error)
	detailFunc func(id int) (*models.GasStation, error)
}

func (m *mockStationProvider) SearchZone(lat, lng float64, radius int) (*models.SearchResponse, error) {
	return m.searchFunc(lat, lng, radius)
}
func (m *mockStationProvider) GetFuels() ([]models.FuelType, error) {
	return m.fuelsFunc()
}
func (m *mockStationProvider) GetServiceArea(id int) (*models.GasStation, error) {
	return m.detailFunc(id)
}

func TestSearchHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{
		searchFunc: func(lat, lng float64, radius int) (*models.SearchResponse, error) {
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
	srv := NewServer(mock)

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
		mock.searchFunc = func(lat, lng float64, radius int) (*models.SearchResponse, error) {
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
}

func TestStationHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{
		detailFunc: func(id int) (*models.GasStation, error) {
			return &models.GasStation{ID: id, Name: "Details"}, nil
		},
	}
	srv := NewServer(mock)

	t.Run("Valid ID", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/station?id=123", nil)
		rr := httptest.NewRecorder()
		srv.StationHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
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
