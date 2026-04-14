package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"carburanti/internal/cache"
	"carburanti/internal/models"
)

type StationProvider interface {
	SearchZone(lat, lng float64, radius int) (*models.SearchResponse, error)
	GetServiceArea(id int) (*models.GasStation, error)
	GetFuels() ([]models.FuelType, error)
}

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Cache      *cache.Cache[any]
}

var _ StationProvider = (*Client)(nil)

func NewClient(baseURL string, c *cache.Cache[any]) *Client {
	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		Cache: c,
	}
}

func (c *Client) doRequest(method, url string, body []byte) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CarburantiApp/1.0)")
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(b))
	}

	return io.ReadAll(resp.Body)
}

func (c *Client) SearchZone(lat, lng float64, radius int) (*models.SearchResponse, error) {
	cacheKey := fmt.Sprintf("search:%f:%f:%d", lat, lng, radius)
	if val, found := c.Cache.Get(cacheKey); found {
		return val.(*models.SearchResponse), nil
	}

	payload := models.SearchRequest{
		Points: []models.Location{{Lat: lat, Lng: lng}},
		Radius: radius,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	respBody, err := c.doRequest("POST", c.BaseURL+"/search/zone", body)
	if err != nil {
		return nil, err
	}

	var res models.SearchResponse
	if err := json.Unmarshal(respBody, &res); err != nil {
		return nil, err
	}

	c.Cache.Set(cacheKey, &res, 5*time.Minute)
	return &res, nil
}

func (c *Client) GetServiceArea(id int) (*models.GasStation, error) {
	cacheKey := fmt.Sprintf("station:%d", id)
	if val, found := c.Cache.Get(cacheKey); found {
		return val.(*models.GasStation), nil
	}

	url := fmt.Sprintf("%s/registry/servicearea/%d", c.BaseURL, id)
	respBody, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	var res models.GasStation
	if err := json.Unmarshal(respBody, &res); err != nil {
		return nil, err
	}

	c.Cache.Set(cacheKey, &res, 10*time.Minute)
	return &res, nil
}

func (c *Client) GetFuels() ([]models.FuelType, error) {
	if val, found := c.Cache.Get("fuels"); found {
		return val.([]models.FuelType), nil
	}

	url := c.BaseURL + "/registry/fuels"
	respBody, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	type rawFuelType struct {
		ID          string `json:"id"`
		Description string `json:"description"`
	}
	type rawFuelResponse struct {
		Results []rawFuelType `json:"results"`
	}

	var res rawFuelResponse
	if err := json.Unmarshal(respBody, &res); err != nil {
		return nil, err
	}

	var filtered []models.FuelType
	for _, f := range res.Results {
		if len(f.ID) > 2 && f.ID[len(f.ID)-2:] == "-x" {
			idStr := f.ID[:len(f.ID)-2]
			if id, err := strconv.Atoi(idStr); err == nil {
				filtered = append(filtered, models.FuelType{
					ID:   id,
					Name: f.Description,
				})
			}
		}
	}

	c.Cache.Set("fuels", filtered, 24*time.Hour)
	return filtered, nil
}

func (c *Client) SendLogos() error {
	return nil
}
