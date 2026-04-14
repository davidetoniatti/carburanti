# Carburanti - Fuel Prices Map Italy

Go web application that shows an interactive map of fuel prices in Italy, using real-time data from the official osservaprezzi MISE portal.

## Features

- OpenStreetMap with color-coded markers based on price
- Fuel type selection
- Self / Served / Lowest price modes
- User GPS localization
- Search by clicking on the map or using current position
- Detailed panel with full prices, opening hours, and contacts

## Quick Start

```bash
git clone https://github.com/davidetoniatti/carburanti
cd carburanti
go run .
```

Then open: http://localhost:8080

## How to use

1. **Click on the map** to search for stations in the area
2. **Use "Locate me"** to find stations near you
3. **Select fuel type** from the top menu
4. **Choose mode**: Self (self-service), Served, or Lowest Price
5. **Click a marker** on the map to see station details

## Structure

```
carburanti/
├── main.go                    # HTTP Server + static files embedding
├── internal/
│   ├── api/                   # Clients for external APIs
│   │   ├── client.go          # MISE API client
│   │   └── geocode.go         # Nominatim Geocoding client
│   ├── app/                   # App bootstrap and middlewares
│   ├── cache/                 # Generic thread-safe cache
│   ├── handlers/              # HTTP handlers
│   └── models/                # Data structures
└── static/
    ├── index.html
    ├── css/style.css
    └── js/                    # Modular frontend logic
        ├── api.js             # API interaction
        ├── app.js             # App entry point
        ├── map.js             # Leaflet map logic
        └── ...
```

## API Endpoints (proxy)

- `GET /api/search?lat=&lng=&radius=` — Search for stations in the area
- `GET /api/station?id=` — Station details
- `GET /api/fuels` — Fuel types list
- `GET /api/geocode?q=` — Geocoding proxy to Nominatim

## Production Build

```bash
go build -o carburanti .
./carburanti
```

The binary includes all static files (embedded).
