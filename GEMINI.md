# GEMINI.md

Onboarding for AI coding assistants working on this project. Read this first.

## What this is

**OhMyPieno**: Go web app serving an interactive map of fuel prices in Italy.
The Go server is both a static-file host (embedded frontend via `//go:embed`)
and a proxy for two upstreams:

- **MIMIT** (`carburanti.mise.gov.it/ospzApi`) — official Italian ministry API
  for stations and prices.
- **Nominatim** (`nominatim.openstreetmap.org`) — OSM geocoder for address
  search.

Frontend is vanilla ES modules with Leaflet. No bundler, no framework, no
build step.

## Layout

```
ohmypieno/
├── main.go                 # entry point, //go:embed static
├── e2e_test.go             # top-level smoke test (uses the real embedded tree)
├── internal/
│   ├── app/                # bootstrap, middleware chain, rate limiter, gzip, config
│   ├── api/                # upstream clients (MIMIT + Nominatim) with singleflight
│   ├── cache/              # generic LRU+TTL cache
│   ├── handlers/           # HTTP handlers + validation middleware
│   └── models/             # shared types
├── static/
│   ├── index.html
│   ├── manifest.json
│   ├── css/style.css
│   └── js/                 # ES modules (see "Frontend patterns" below)
├── Dockerfile, docker-compose.yml, .dockerignore
├── go.mod, go.sum          # only two external deps
```

## Commands

- `go build ./...`
- `go test ./... -race` — race must stay clean; the suite has passed 30 iterations without flakes.
- `go vet ./...`
- `go run .` — serves on `:8080`.
- `docker compose up --build`

Environment:
- `PORT` (default 8080)
- `OHMYPIENO_API_URL` (default `https://carburanti.mise.gov.it/ospzApi`)
- `TRUST_PROXY_HEADERS=true` — only when behind a trusted reverse proxy. Controls whether the rate limiter honors `X-Forwarded-For` / `X-Real-IP`.

External dependencies (intentionally minimal):
- `golang.org/x/sync/singleflight` — request coalescing.
- `golang.org/x/time/rate` — rate limiter.

## Middleware chain

```
Logging → SecurityHeaders → Gzip → RateLimit → CacheControl → mux
```

Order matters:
- SecurityHeaders sits outside Gzip so 429s and errors still carry headers.
- RateLimit only gates `/api/*`; static assets pass through unthrottled.
- Gzip skips pre-encoded responses (checked inside the wrapper at first write,
  not before the handler runs — the earlier version was buggy).

## Architecture invariants — don't break these

1. **All upstream calls go through singleflight** (`internal/api/client.go`,
   `geocode.go`). N concurrent identical requests → 1 upstream call. Covered
   by `TestClient_SingleflightCoalescing`.

2. **Coordinate quantization to 4 decimals** in both backend
   (`client.go:SearchZone`) and frontend (`api.js:getQuantizedKey`). Sub-meter
   pan shouldn't miss the cache.

3. **Cache is LRU-bounded** (`internal/cache/cache.go`, default 10k entries).
   Adding an unbounded `map[string]T` cache is a DoS vector.

4. **`SearchHandler` deep-copies `Fuels` only when a fuel filter is applied**.
   Enrichment mutates; no filter → no mutation risk → no copy. Regression test:
   `TestSearchHandler_CacheMutationReproduction`.

5. **Gzip wrapper decides at first `Write`/`WriteHeader`**, based on
   `Content-Type`. Pool via `sync.Pool`, drop `Content-Length`, skip
   already-encoded responses. Do not re-introduce the
   "check Content-Encoding before handler runs" pattern. Regression test:
   `TestIntegration_GzipSkipsAlreadyEncoded`.

6. **Rate limiter gates by IP**. `X-Forwarded-For` honored **only** when
   `TrustProxyHeaders=true`.

7. **`StationProvider` / `Geocoder` interfaces take `context.Context` as
   first arg.** There are no `WithContext` variants.

8. **`/api/fuels` is hardcoded** in `client.go` (no upstream call). Its
   `Cache-Control` is `public, max-age=86400, immutable`.

9. **`app.New` takes `fs.FS`**, not `embed.FS`. Tests use `fstest.MapFS`.

## Frontend patterns

1. **`state.js`** is a singleton object for live UI state. Keep it that way.
2. **`TTLCache`** in `api.js` is LRU with touch-on-get. `searchStations`
   **deletes** the cache entry on fetch rejection. Do not re-introduce the
   "cache the rejected promise for 5 minutes" bug.
3. **`AbortController`** pattern: a new search aborts the previous one.
   Same for station details.
4. **`#controls`** moves between `#desktopControlsSlot` and
   `#mobileControlsSlot` via JS at breakpoint changes. Children travel with
   it. Mobile-only UI inside `#controls` uses `.mobile-only`, hidden on
   desktop via media query.
5. **Keyboard shortcuts** (`keyboard.js`) gate by **target availability**,
   not viewport: each handler checks `el.offsetParent !== null`. This keeps
   shortcuts working on mobile+keyboard combos and auto-disables when the
   target isn't rendered.
6. **Tutorial highlights** are real UI elements with `pointer-events: none`.
   The overlay backdrop is **intentionally transparent** — dimming it
   defeats the purpose of pointing at live UI. Spotlight-via-clip-path is
   on the roadmap.
7. **`STORAGE_KEYS`** in `constants.js` is the source of truth for
   localStorage keys. Don't introduce string literals.
8. **i18n**: `i18n.js` holds translation tables; `t(key, params)` interpolates.
   Static elements use `data-i18n` / `data-i18n-title` / `data-i18n-placeholder`.
   Dynamic UI (tutorial, help modal) re-renders via module-level refresh
   functions (`refreshTutorialIfActive` in `tutorial.js`). The help modal
   (`keyboard.js:openShortcutsHelp`) does **not** yet have this — language
   change while open leaves it stale. Listed on the roadmap.

## Non-obvious trivia

- `//go:embed static` embeds relative to the source file. `fs.Sub(fsys, "static")`
  is called inside `app.New`. Tests pass `fstest.MapFS` with a `"static/"`
  prefix; see `internal/app/integration_test.go`.
- `e2e_test.go` at repo root reuses the `main` package's `staticFiles` — the
  real embedded tree. `internal/app/*_test.go` use fake FS.
- Nominatim's ToS requires identifying `User-Agent`; it's set in `geocode.go`.
  Don't remove it.
- `MaxRadius` / `LatMin/Max` / `LngMin/Max` in `config.go` are Italy-specific;
  changing them changes what `ValidateSearchMiddleware` accepts.
- The tutorial's "Replay" affordance is only reachable via the `?` shortcut
  on desktop or the mobile Help button inside the filter drawer — there is
  no desktop-visible button for it by design.
- Docker compose has no `ports:` mapping by design (it's left to the
  deployment context to expose or proxy).

## Testing conventions

- Each `internal/*` package has its own test file(s).
- Integration tests live in `internal/app/integration_test.go` and exercise
  the full middleware chain.
- Regression tests carry inline comments explaining *which bug* they catch.
  Preserve those comments — they outlive the incident.
- Concurrency tests use the race detector and should run 30+ iterations
  cleanly.
- Flaky test known to the team: `TestClient_SingleflightCancellation` uses a
  `time.Sleep(20ms)` as a pseudo-sync-barrier. Replacing with a channel
  barrier is on the roadmap.

## How the user works

- **Reply in English.** Technical terms and identifiers stay as-is.
- **No emojis** unless explicitly requested.
- **Commits** use Conventional Commits, lowercase, period at end:
  `feat: short thing.`, `fix: ...`, `perf: ...`, `refactor: ...`, `test: ...`.
  No `Co-Authored-By` trailer. Never `--amend` a previous commit; make a new
  one instead.
- **Commit split**: when a change spans multiple themes, split into focused
  commits. Mixed-file changes require hunk surgery (snapshot the file, revert
  to HEAD, apply one theme, commit, restore full state, commit rest). Tedious
  but the user values clean history.
- **Plan before code** on non-trivial changes — two or three sentences, wait
  for acknowledgement. Don't code in response to exploratory questions.
- **When pushed back on, reframe** rather than tweak. The user values coherent
  principles (example: "target availability" replaced "viewport gating" on
  keyboard shortcuts after pushback — the rule got simpler, not more complex).
- **Don't run destructive git** (force-push, hard reset, branch -D) without
  explicit permission.
- Terse responses. One- to two-sentence end-of-turn summaries.

## Roadmap snapshot (2026-04-18)

Recently completed:
- Backend: bounded cache, rate limiter, security headers, gzip refactor
  (pool + MIME skip + Content-Length), long cache on `/api/fuels`, interface
  cleanup, fuel deep-copy optimization, `fs.FS` signature.
- Frontend: desktop panel close buttons, tutorial a11y (keyboard nav, aria,
  focus trap, reduced motion), global keyboard shortcuts + help modal, mobile
  Help button, tutorial deferred to first search, live i18n refresh, storage
  keys centralized.

Open items:
- **Tier 3 tutorial polish, narrowed**. Two original items (spotlight
  backdrop, modal positioned relative to highlight) were built and reverted
  — see below. What's still safe to do:
  - Per-step icons inside the modal (inline SVG per step in `TUTORIAL_STEPS`).
  - `history.pushState` on open + `popstate` listener so browser-back dismisses.
  - Subtle pulse animation on `.tutorial-highlight` glow.
  - "Step N of M" label somewhere in the modal header.
- **Tier 4 tutorial**: progressive onboarding (tooltip coachmarks),
  state-machine unit tests (needs jsdom or similar).
- **CSP header**: deferred pending an inventory of Leaflet/unpkg/Google Fonts
  or self-hosting them.
- **Controls slot swap**: JS DOM move → CSS `order` reshuffle.
- **Flaky sleep in `TestClient_SingleflightCancellation`**.

## Tutorial design constraints (learned the hard way)

Two Tier-3 items were implemented, tried, and reverted. Read these before
proposing any tutorial visual change:

1. **Do not dim the overlay.** The tutorial points at real UI elements on
   the live page. Any dim (flat or spotlight-with-cutout) either hides
   the highlighted element or triggers stacking issues that cascade into
   worse fixes. The overlay stays transparent; the modal sits on top with
   its own border/shadow.
2. **Do not move the modal between steps.** Tooltip-style anchoring next to
   the highlighted element was built and rejected as disorienting — each
   "Next" click jumped the whole modal somewhere new. The text is the
   primary content; reading flow matters more than spatial pointers.
   Flex-centered, always.
3. **Highlights communicate targets, alone.** The existing
   `.tutorial-highlight` pattern (accent `box-shadow` glow + `z-index: 4000`
   + `pointer-events: none`) is the only visual mechanism for "look at
   this element." Any enhancement should work *with* this, not around it.
