# Project Status — Bluegill Bite Forecast

> **Purpose:** the "start here" handoff note. Read this first to understand what the
> app is, how it's built, where things stand, and what's next. For *why* past choices
> were made, see `DECISIONS.md`.
>
> **Keep it current:** at the end of any substantive change, update the "Current state",
> "What's next", and "Known limitations" sections below (and add a dated entry to
> `DECISIONS.md` for anything non-obvious).

_Last updated: 2026-10-03_

---

## 1. What the app is

A lightweight, beginner-friendly fishing forecast web app focused on **bite timing**
for **bluegill** and **largemouth bass**. It pulls free weather + moon data, computes
an hourly BiteScore per species, and shows the best windows on a chart. All user data
(custom spots, favorites, trip logs) is stored locally in the browser.

- **Stack:** static HTML / CSS / vanilla JS. **No framework, no build step, no backend.**
- **Runs:** open `biteforecast.html` directly, or serve the folder with Live Server.
- **Data sources (free, no API key):**
  - Weather — Open-Meteo hourly forecast (`timezone=auto`).
  - Moon / solunar — USNO (US Naval Observatory) one-day API.

## 2. Architecture map

The JS is split into six classic `<script>` files that **share one global scope**,
loaded in dependency order. There are no modules/imports — load order is what makes it
work, so keep it intact in `biteforecast.html`:

```
spots → core → scoring → storage → rendering → app
```

| File | Role |
|------|------|
| `spots.js` | Built-in fishing spot data (the `spots` array). Not user data. |
| `core.js` | Config constants, `STORAGE_KEYS`, `fetchWithTimeout`, and low-level utilities (escaping, clamp, date/time, spot-type, USNO time parsing). |
| `scoring.js` | **Pure** BiteScore logic (bluegill + bass) and `buildHourlyForecast`. No DOM, no network. |
| `storage.js` | localStorage persistence (favorites, custom spots, trip logs), the forecast cache, and export/import. |
| `rendering.js` | DOM element references + every function that draws the UI (forecast summary, hourly chart, selected hour, spot lists, trip log, insights). |
| `app.js` | Orchestrator: `getForecast`, moon fetch, Leaflet map, interactive modals, bootstrap + all event wiring. Loaded last. |

**Rule of thumb for where new code goes:** pure math → `scoring.js`; anything touching
localStorage → `storage.js`; anything building HTML/DOM → `rendering.js`; fetch,
user events, and glue → `app.js`; shared helper used by several files → `core.js`.

## 3. Current state (what works today)

- Hourly BiteScore for **bluegill and bass**, single shared chart with a species toggle.
- Inputs: sunrise/sunset, temperature, cloud cover, wind, pressure trend, moon/solunar,
  spot type, season. Weighted, season-aware model.
- Leaflet map, built-in + custom saved spots, favorites, trip logs, and trip-log insights.
- **Reliability work (done, v0.2 / APP_VERSION 1.5.0):**
  - Moon/solunar **time zone aligned** to the spot's local time (see `DECISIONS.md` D6).
  - **Resilient loading:** weather is required; moon is optional enrichment. On moon
    failure the forecast still renders, moon fields show "Unavailable", and moon/solunar
    scoring is neutral (0). 12s `AbortController` timeouts on both APIs. Forecast button
    is disabled while loading (no double-fire).
  - **Forecast cache:** last successful forecast saved per spot+date; used as a labeled
    fallback when the network fails. Stale after 6h (today) / 24h (future dates).
  - **Backup:** Export / Import buttons for custom spots, favorites, trip logs
    (merge-only, validated, de-duplicated).
  - **Forecast confidence** badge (High / Medium / Low) based only on how far out the
    date is.
- **Code structure:** `app.js` was split into the six files above (purely a
  reorganization — no behavior change; verified in-browser).

## 4. What's next (backlog, roughly prioritized)

- **UI / PWA redesign (the planned next phase).** Service worker, manifest, and
  installability were intentionally deferred and should be their own effort.
- Consider an **import "replace" mode** (currently merge-only by design).
- Consider splitting `rendering.js` further (e.g. an `insights.js`) if it keeps growing.
- Longer term: use trip-log data for **prediction-accuracy calibration** of the model
  (explicitly *not* attempted yet — would change scoring and needs its own plan).

## 5. Known limitations & assumptions

- **Local-only data.** No accounts, no cross-device sync. Export/Import is the backup
  mechanism. Clearing browser storage loses custom spots/favorites/trip logs.
- **Network-dependent & free APIs.** Open-Meteo and USNO have no keys but unknown rate
  limits; the cache softens brief outages but isn't a substitute for connectivity.
- **Moon is a secondary influence** and goes fully neutral when unavailable — a forecast
  with missing moon data is still valid, just slightly less informed.
- **Time zone** relies on Open-Meteo's `utc_offset_seconds` for the spot/date (it handles
  DST); USNO is queried with that same offset so all times share one local basis.
- Forecast cache is capped at 24 snapshots to keep localStorage small.

## 6. How to run & test

- **Run:** open `biteforecast.html`, or Live Server the folder.
- **Manual smoke test:** load a forecast; toggle species; click a chart bar; open
  My Spots / Trip Log / Insights; add a custom spot; Export then Import the file.
- **Reliability checks:** simulate a moon-API failure (forecast still renders, moon =
  "Unavailable"); simulate a weather failure with a matching cache (shows labeled cached
  result) and without one (clean error); check confidence labels for today / +3d / +6d.

## 7. Guardrails (from CLAUDE.md — don't violate without being asked)

- No paid APIs, no heavy dependencies, no framework/build/backend.
- Keep weather + time-of-day as the primary scoring factors; keep moon/solunar modest.
- **Do not change BiteScore weights or thresholds** unless explicitly asked.
- Keep code beginner-readable; preserve existing UI/behavior unless a change requires it.
- Keep all localStorage keys in `STORAGE_KEYS` (`core.js`), never scattered strings.
