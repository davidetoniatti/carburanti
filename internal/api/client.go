package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/sync/singleflight"

	"carburanti/internal/cache"
	"carburanti/internal/models"
)

type StationProvider interface {
	SearchZone(lat, lng float64, radius int) (*models.SearchResponse, error)
	SearchZoneWithContext(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error)
	GetServiceArea(id int) (*models.GasStation, error)
	GetServiceAreaWithContext(ctx context.Context, id int) (*models.GasStation, error)
	GetFuels() ([]models.FuelType, error)
	GetFuelsWithContext(ctx context.Context) ([]models.FuelType, error)
}

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Cache      *cache.Cache[any]
	sfGroup    singleflight.Group
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

func (c *Client) doRequest(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
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
	return c.SearchZoneWithContext(context.Background(), lat, lng, radius)
}

func (c *Client) SearchZoneWithContext(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
	// Quantize coordinates to improve cache hits
	// 4 decimals is approx 11m at equator, good enough for "same area"
	qLat := math.Round(lat*10000) / 10000
	qLng := math.Round(lng*10000) / 10000

	cacheKey := fmt.Sprintf("search:%f:%f:%d", qLat, qLng, radius)

	// Check cache
	if val, found := c.Cache.Get(cacheKey); found {
		return val.(*models.SearchResponse), nil
	}

	// Coalesce identical requests
	res, err, _ := c.sfGroup.Do(cacheKey, func() (any, error) {
		payload := models.SearchRequest{
			Points: []models.Location{{Lat: lat, Lng: lng}},
			Radius: radius,
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		respBody, err := c.doRequest(ctx, "POST", c.BaseURL+"/search/zone", body)
		if err != nil {
			return nil, err
		}

		var searchRes models.SearchResponse
		if err := json.Unmarshal(respBody, &searchRes); err != nil {
			return nil, err
		}

		c.Cache.Set(cacheKey, &searchRes, 5*time.Minute)
		return &searchRes, nil
	})

	if err != nil {
		return nil, err
	}
	return res.(*models.SearchResponse), nil
}

func (c *Client) GetServiceArea(id int) (*models.GasStation, error) {
	return c.GetServiceAreaWithContext(context.Background(), id)
}

func (c *Client) GetServiceAreaWithContext(ctx context.Context, id int) (*models.GasStation, error) {
	cacheKey := fmt.Sprintf("station:%d", id)
	if val, found := c.Cache.Get(cacheKey); found {
		return val.(*models.GasStation), nil
	}

	// Coalesce station detail requests too
	res, err, _ := c.sfGroup.Do(cacheKey, func() (any, error) {
		url := fmt.Sprintf("%s/registry/servicearea/%d", c.BaseURL, id)
		respBody, err := c.doRequest(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}

		var station models.GasStation
		if err := json.Unmarshal(respBody, &station); err != nil {
			return nil, err
		}

		c.Cache.Set(cacheKey, &station, 10*time.Minute)
		return &station, nil
	})

	if err != nil {
		return nil, err
	}
	return res.(*models.GasStation), nil
}

func (c *Client) GetFuels() ([]models.FuelType, error) {
	return c.GetFuelsWithContext(context.Background())
}

func (c *Client) GetFuelsWithContext(ctx context.Context) ([]models.FuelType, error) {
	cacheKey := "fuels"
	if val, found := c.Cache.Get(cacheKey); found {
		return val.([]models.FuelType), nil
	}

	res, err, _ := c.sfGroup.Do(cacheKey, func() (any, error) {
		url := c.BaseURL + "/registry/fuels"
		respBody, err := c.doRequest(ctx, "GET", url, nil)
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

		var fuelResp rawFuelResponse
		if err := json.Unmarshal(respBody, &fuelResp); err != nil {
			return nil, err
		}

		var filtered []models.FuelType
		for _, f := range fuelResp.Results {
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

		c.Cache.Set(cacheKey, filtered, 24*time.Hour)
		return filtered, nil
	})

	if err != nil {
		return nil, err
	}
	return res.([]models.FuelType), nil
}
