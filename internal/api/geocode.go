package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/sync/singleflight"

	"carburanti/internal/cache"
)

type Geocoder interface {
	GeocodeWithContext(ctx context.Context, query, lang string) (any, error)
}

type NominatimClient struct {
	HTTPClient *http.Client
	Cache      *cache.Cache[any]
	sfGroup    singleflight.Group
}

func NewNominatimClient(c *cache.Cache[any]) *NominatimClient {
	return &NominatimClient{
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		Cache: c,
	}
}

func (c *NominatimClient) GeocodeWithContext(ctx context.Context, query, lang string) (any, error) {
	// Sanitize Accept-Language header to prevent log injection or abuse
	// We only care about it/en/empty.
	safeLang := ""
	if lang != "" {
		if len(lang) > 2 {
			lang = lang[:2]
		}
		if lang == "it" || lang == "en" {
			safeLang = lang
		}
	}

	// Use a non-colliding separator \x00
	cacheKey := fmt.Sprintf("geocode:%s\x00%s", query, safeLang)
	if val, found := c.Cache.Get(cacheKey); found {
		return val, nil
	}

	ch := c.sfGroup.DoChan(cacheKey, func() (any, error) {
		u := fmt.Sprintf("https://nominatim.openstreetmap.org/search?format=json&q=%s&countrycodes=it&limit=1",
			url.QueryEscape(query))

		req, err := http.NewRequestWithContext(context.Background(), "GET", u, nil)
		if err != nil {
			return nil, err
		}
		if safeLang != "" {
			req.Header.Set("Accept-Language", safeLang)
		}
		req.Header.Set("User-Agent", "CarburantiApp/1.0")

		resp, err := c.HTTPClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("nominatim returned %d", resp.StatusCode)
		}

		var results []any
		if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
			return nil, err
		}

		c.Cache.Set(cacheKey, results, 24*time.Hour)
		return results, nil
	})

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		return res.Val, nil
	}
}
