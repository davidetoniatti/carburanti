package main

import (
	"embed"
	"errors"
	"log/slog"
	"net/http"
	"os"

	"ohmypieno/internal/app"
)

//go:embed static
var staticFiles embed.FS

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	baseURL := os.Getenv("OHMYPIENO_API_URL")
	if baseURL == "" {
		baseURL = "https://carburanti.mise.gov.it/ospzApi"
	}

	application, err := app.New(baseURL, staticFiles)
	if err != nil {
		slog.Error("failed to create app", "error", err)
		os.Exit(1)
	}
	defer application.Close()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := application.Run(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped with error", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped gracefully")
}
