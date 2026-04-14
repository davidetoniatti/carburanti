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
# Requires Go 1.21+
git clone ...
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
│   ├── api/client.go          # Client for the osservaprezzi API
│   ├── handlers/handlers.go   # HTTP handlers (proxy to API)
│   └── models/models.go       # Data structures
└── static/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## API Endpoints (proxy)

- `GET /api/search?lat=&lng=&radius=` — Search for stations in the area
- `GET /api/station?id=` — Station details
- `GET /api/fuels` — Fuel types list

## Production Build

```bash
go build -o carburanti .
./carburanti
```

The binary includes all static files (embedded).
