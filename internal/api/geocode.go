package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/sync/singleflight"

	"ohmypieno/internal/cache"
)

type Geocoder interface {
	Geocode(ctx context.Context, query, lang string) (any, error)
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

func (c *NominatimClient) Geocode(ctx context.Context, query, lang string) (any, error) {
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
		// Increase limit to 5 to support suggestions
		u := fmt.Sprintf("https://nominatim.openstreetmap.org/search?format=json&q=%s&countrycodes=it&limit=5",
			url.QueryEscape(query))

		// Background context so one caller's cancellation doesn't fail
		// the shared upstream call for other waiters on this key.
		// HTTPClient.Timeout still bounds the request duration.
		req, err := http.NewRequestWithContext(context.Background(), "GET", u, nil)
		if err != nil {
			return nil, err
		}
		if safeLang != "" {
			req.Header.Set("Accept-Language", safeLang)
		}
		req.Header.Set("User-Agent", "OhMyPienoApp/1.0")

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
