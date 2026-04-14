package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"carburanti/internal/api"
	"carburanti/internal/models"
)

type Server struct {
	Client api.StationProvider
}

func NewServer(client api.StationProvider) *Server {
	return &Server{
		Client: client,
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
	mode := q.Get("mode") // self, served, best

	if latStr == "" || lngStr == "" {
		s.errorJSON(w, "lat and lng are required", http.StatusBadRequest)
		return
	}
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil || lat < 35 || lat > 48 {
		s.errorJSON(w, "invalid or out of range lat", http.StatusBadRequest)
		return
	}
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil || lng < 6 || lng > 19 {
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

	if mode != "" && mode != "self" && mode != "served" && mode != "best" {
		s.errorJSON(w, "invalid mode", http.StatusBadRequest)
		return
	}

	result, err := s.Client.SearchZoneWithContext(r.Context(), lat, lng, radius)
	if err != nil {
		log.Printf("SearchZone error: %v", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}

	// Apply business rules: find best price for requested fuel/mode
	// We MUST NOT mutate the original result because it might be a cached pointer.
	// Instead, we build a new slice of stations for the response.
	enrichedResults := make([]models.GasStation, len(result.Results))
	copy(enrichedResults, result.Results)

	if fuelID > 0 {
		for i := range enrichedResults {
			price, name := s.calculateSelectedPrice(&enrichedResults[i], fuelID, mode)
			enrichedResults[i].SelectedPrice = price
			enrichedResults[i].SelectedFuelName = name
		}
	}

	response := models.SearchResponse{
		Success: result.Success,
		Center:  result.Center,
		Results: enrichedResults,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) calculateSelectedPrice(station *models.GasStation, fuelID int, mode string) (float64, string) {
	var bestPrice float64
	var fuelName string

	for _, f := range station.Fuels {
		if f.FuelID != fuelID {
			continue
		}
		
		isMatch := false
		switch mode {
		case "self":
			isMatch = f.IsSelf
		case "served":
			isMatch = !f.IsSelf
		default: // "best" or any other
			isMatch = true
		}

		if isMatch {
			if bestPrice == 0 || f.Price < bestPrice {
				bestPrice = f.Price
				fuelName = f.Name
			}
		}
	}
	return bestPrice, fuelName
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
		log.Printf("GetServiceArea error: %v", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(station)
}

func (s *Server) FuelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.errorJSON(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	fuels, err := s.Client.GetFuelsWithContext(r.Context())
	if err != nil {
		log.Printf("GetFuels error: %v", err)
		s.errorJSON(w, "upstream service error", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(fuels)
}

func (s *Server) errorJSON(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
