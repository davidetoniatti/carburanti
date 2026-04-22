<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
      <img src="logo-light.svg" alt="OhMyPieno" style="width: 50%; height: auto;">
    </picture>
</p>

**OhMyPieno** is an interactive map of fuel prices in Italy. The data comes from MIMIT's public portal ([carburanti.mise.gov.it](https://carburanti.mise.gov.it)). This is just a friendlier way to browse it.

## What it does

- Find stations by address, by clicking on the map, or from your current location.
- Filter by fuel type, brand, and search radius.
- Open a station to see every pump's self-service and attended price, plus contacts and distance.
- Markers are colored from cheapest to most expensive.

## Running it

```bash
go run .
```

Listens on `:8080`. The frontend is embedded in the binary with `go:embed`, so `go build -o ohmypieno .` gives you a single file to deploy.

A `Dockerfile` and `docker-compose.yml` are in the repo:

```bash
docker compose up -d
```

Go 1.25 or newer for local development.

## Configuration

| Variable              | Description                                  | Default                                  |
| --------------------- | -------------------------------------------- | ---------------------------------------- |
| `PORT`                | HTTP port                                    | `8080`                                   |
| `OHMYPIENO_API_URL`   | MIMIT base URL                               | `https://carburanti.mise.gov.it/ospzApi` |
| `TRUST_PROXY_HEADERS` | Honor `X-Forwarded-For` for rate-limiting    | unset                                    |

## Layout

```
ohmypieno/
├── main.go                entry point, embeds the static bundle
├── internal/
│   ├── api/               upstream clients (MIMIT + Nominatim)
│   ├── app/               bootstrap, middleware chain, rate limiter, gzip
│   ├── cache/             generic LRU + TTL
│   ├── handlers/          HTTP handlers and validation
│   ├── models/            shared types
│   └── obs/               per-request upstream-timing tracker
└── static/
    ├── index.html
    ├── css/
    └── js/                vanilla ES modules
```

## API

- `GET /api/search?lat=&lng=&radius=&fuel=&brand=` — stations near a point.
- `GET /api/station?id=` — one station's details.
- `GET /api/fuels` — the fuel type list.
- `GET /api/geocode?q=` — address lookup, proxied to Nominatim.
