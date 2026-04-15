package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"ohmypieno/internal/api"
	"ohmypieno/internal/models"
)

const (
	FuelBenzina = 1
	FuelGasolio = 2
	FuelHVO     = 3
	FuelGPL     = 4
	FuelMetano  = 5
)

const (
	italyLatMin, italyLatMax = 35.0, 48.0
	italyLngMin, italyLngMax = 6.0, 19.0
)

type Server struct {
	Client   api.StationProvider
	Geocoder api.Geocoder
}

func NewServer(client api.StationProvider, geocoder api.Geocoder) *Server {
	return &Server{
		Client:   client,
		Geocoder: geocoder,
	}
}

func (s *Server) SearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.errorJSON(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	latStr := q.Get("lat")
	lngStr := q.Get("lng")
	radiusStr := q.Get("radius")
	fuelIDStr := q.Get("fuel")

	if latStr == "" || lngStr == "" {
		s.errorJSON(w, "lat and lng are required", http.StatusBadRequest)
		return
	}
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil || lat < italyLatMin || lat > italyLatMax {
		s.errorJSON(w, "invalid or out of range lat", http.StatusBadRequest)
		return
	}
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil || lng < italyLngMin || lng > italyLngMax {
		s.errorJSON(w, "invalid or out of range lng", http.StatusBadRequest)
		return
	}
	radius, _ := strconv.Atoi(radiusStr)
	if radius <= 0 {
		radius = 5
	}
	if radius > 50 {
		s.errorJSON(w, "radius too large (max 50km)", http.StatusBadRequest)
		return
	}

	fuelID, _ := strconv.Atoi(fuelIDStr)

	result, err := s.Client.SearchZoneWithContext(r.Context(), lat, lng, radius)
	if err != nil {
		slog.Error("SearchZone error", "error", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}

	enrichedResults := make([]models.GasStation, len(result.Results))
	copy(enrichedResults, result.Results)

	if fuelID > 0 {
		for i := range enrichedResults {
			price, name := s.calculateSelectedPrice(&enrichedResults[i], fuelID)
			enrichedResults[i].SelectedPrice = price
			enrichedResults[i].SelectedFuelName = name
		}
	}

	response := models.SearchResponse{
		Success: result.Success,
		Center:  result.Center,
		Results: enrichedResults,
	}

	s.writeJSON(w, response)
}

func (s *Server) writeJSON(w http.ResponseWriter, data any) {
	buf, err := json.Marshal(data)
	if err != nil {
		slog.Error("json.Marshal error", "error", err)
		s.errorJSON(w, "internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(buf)
}

func (s *Server) calculateSelectedPrice(station *models.GasStation, fuelID int) (float64, string) {
	var bestPrice float64
	var fuelName string

	for _, f := range station.Fuels {
		if !s.isFuelMatch(f, fuelID) {
			continue
		}

		if bestPrice == 0 || f.Price < bestPrice {
			bestPrice = f.Price
			fuelName = f.Name
		}
	}
	return bestPrice, fuelName
}

func (s *Server) isFuelMatch(f models.Fuel, fuelID int) bool {
	name := strings.ToLower(strings.TrimSpace(f.Name))
	switch fuelID {
	case FuelBenzina:
		return name == "benzina"
	case FuelGasolio:
		return name == "gasolio"
	case FuelHVO:
		return strings.Contains(name, "hvo")
	case FuelGPL:
		return strings.Contains(name, "gpl")
	case FuelMetano:
		return strings.Contains(name, "metano")
	}
	return false
}

func (s *Server) StationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.errorJSON(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		s.errorJSON(w, "id required", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		s.errorJSON(w, "invalid station id", http.StatusBadRequest)
		return
	}
	station, err := s.Client.GetServiceAreaWithContext(r.Context(), id)
	if err != nil {
		slog.Error("GetServiceArea error", "error", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}
	s.writeJSON(w, station)
}

func (s *Server) FuelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.errorJSON(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	fuels, err := s.Client.GetFuelsWithContext(r.Context())
	if err != nil {
		slog.Error("GetFuels error", "error", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}
	s.writeJSON(w, fuels)
}

func (s *Server) GeocodeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.errorJSON(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		s.errorJSON(w, "query required", http.StatusBadRequest)
		return
	}

	results, err := s.Geocoder.GeocodeWithContext(r.Context(), q, r.Header.Get("Accept-Language"))
	if err != nil {
		slog.Error("Geocode error", "error", err)
		s.errorJSON(w, "geocoding service error", http.StatusBadGateway)
		return
	}
	s.writeJSON(w, results)
}

func (s *Server) errorJSON(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
