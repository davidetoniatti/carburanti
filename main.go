package main

import (
	"embed"
	"log"
	"os"

	"carburanti/internal/app"
)

//go:embed static
var staticFiles embed.FS

func main() {
	baseURL := os.Getenv("CARBURANTI_API_URL")
	if baseURL == "" {
		baseURL = "https://carburanti.mise.gov.it/ospzApi"
	}

	application, err := app.New(baseURL, staticFiles)
	if err != nil {
		log.Fatal(err)
	}
	defer application.Close()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := application.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
