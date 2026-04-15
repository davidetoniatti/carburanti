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

	cfg := app.LoadConfig()

	application, err := app.New(cfg, staticFiles)
	if err != nil {
		slog.Error("failed to create app", "error", err)
		os.Exit(1)
	}
	defer application.Close()

	if err := application.Run(":" + cfg.Port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped with error", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped gracefully")
}
