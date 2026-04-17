package app

import (
	"os"
	"time"
)

type Config struct {
	BaseURL      string
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
	CacheTTL     time.Duration

	// Validation
	LatMin float64
	LatMax float64
	LngMin float64
	LngMax float64
	MaxRadius int
}

func LoadConfig() *Config {
	baseURL := os.Getenv("OHMYPIENO_API_URL")
	if baseURL == "" {
		baseURL = "https://carburanti.mise.gov.it/ospzApi"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		BaseURL:      baseURL,
		Port:         port,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
		CacheTTL:     5 * time.Minute,

		LatMin: 35.0,
		LatMax: 48.0,
		LngMin: 6.0,
		LngMax: 19.0,
		MaxRadius: 50,
	}
}
