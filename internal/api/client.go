package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"golang.org/x/sync/singleflight"

	"ohmypieno/internal/cache"
	"ohmypieno/internal/models"
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

	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; OhMyPienoApp/1.0)")
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
	qLat := math.Round(lat*10000) / 10000
	qLng := math.Round(lng*10000) / 10000

	cacheKey := fmt.Sprintf("search:%f:%f:%d", qLat, qLng, radius)

	// Check cache
	if val, found := c.Cache.Get(cacheKey); found {
		return val.(*models.SearchResponse), nil
	}

	// Coalesce identical requests
	ch := c.sfGroup.DoChan(cacheKey, func() (any, error) {
		payload := models.SearchRequest{
			Points: []models.Location{{Lat: lat, Lng: lng}},
			Radius: radius,
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		// Use background context for the actual request so it's not canceled by the first caller
		respBody, err := c.doRequest(context.Background(), "POST", c.BaseURL+"/search/zone", body)
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

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		return res.Val.(*models.SearchResponse), nil
	}
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
	ch := c.sfGroup.DoChan(cacheKey, func() (any, error) {
		url := fmt.Sprintf("%s/registry/servicearea/%d", c.BaseURL, id)
		respBody, err := c.doRequest(context.Background(), "GET", url, nil)
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

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		return res.Val.(*models.GasStation), nil
	}
}

func (c *Client) GetFuels() ([]models.FuelType, error) {
	return c.GetFuelsWithContext(context.Background())
}

func (c *Client) GetFuelsWithContext(ctx context.Context) ([]models.FuelType, error) {
	return []models.FuelType{
		{ID: 1, Name: "Benzina"},
		{ID: 2, Name: "Gasolio"},
		{ID: 3, Name: "HVO"},
		{ID: 4, Name: "GPL"},
		{ID: 5, Name: "Metano"},
	}, nil
}
