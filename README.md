![sample svg](logo.svg)

Go web application that shows an interactive map of fuel prices in Italy, using real-time data from the official **MIMIT** (ex MISE) portal.

## Features

- **Real-time Data**: Integrated with official Italian Ministry (MIMIT) APIs.
- **Interactive Map**: OpenStreetMap with markers color-coded by price.
- **Search**: Search by city/address.
- **Detail View**: Full price breakdown (Self vs Served), contact info, and distance from your position.
- **Smart Cache**: High-performance backend caching with request coalescing to minimize upstream load.
- **3-Mode Theme**: Supports Dark, Light, and System-adaptive themes with real-time switching.

## Requirements

- Go 1.25+ (for local development)
- Docker and Docker Compose

## Quick Start

### Local execution

```bash
git clone https://github.com/davidetoniatti/ohmypieno
cd ohmypieno
go run .
```

The application will be available at: http://localhost:8080

### Build from source

```bash
go build -o ohmypieno .
./ohmypieno
```

The binary includes all static files (embedded using `go:embed`).

## Deploy with Docker

### Using Docker Compose (Recommended)

```bash
docker-compose up -d
```

### Using Docker directly

1. Build the image:

```bash
docker build -t ohmypieno .
```

2. Run the container:

```bash
docker run -p 8080:8080 ohmypieno
```

## Configuration

The application can be configured using environment variables:

| Variable            | Description               | Default                                  |
| ------------------- | ------------------------- | ---------------------------------------- |
| `PORT`              | HTTP server port          | `8080`                                   |
| `OHMYPIENO_API_URL` | Base URL for the MISE API | `https://carburanti.mise.gov.it/ospzApi` |

## Project Structure

```
ohmypieno/
├── main.go                    # HTTP Server + static files embedding
├── internal/
│   ├── api/                   # Clients for external APIs
│   ├── app/                   # App bootstrap and middlewares
│   ├── cache/                 # Generic thread-safe cache
│   ├── handlers/              # HTTP handlers
│   └── models/                # Data structures
└── static/
    ├── index.html
    ├── css/                   # Stylesheets
    └── js/                    # Modular frontend logic
```

## API Endpoints

- `GET /api/search?lat=&lng=&radius=` — Search for stations in the area
- `GET /api/station?id=` — Station details
- `GET /api/fuels` — Fuel types list
- `GET /api/geocode?q=` — Geocoding proxy to Nominatim
