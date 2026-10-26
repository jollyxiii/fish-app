# Decision Log — Bluegill Bite Forecast

> **Purpose:** a running record of significant decisions and *why* they were made, so
> they don't get re-litigated or accidentally undone in a future chat. For current
> status and architecture, see `PROJECT_STATUS.md`.
>
> **How to add an entry:** newest at the top. Keep it short — Decision, Why, and (if
> useful) Alternatives considered / What would reverse it. Date each entry.

---

## D8 — Handoff docs live in the repo (2026-10-03)
**Decision:** Keep `PROJECT_STATUS.md` and `DECISIONS.md` as standalone files in the
project folder; a new chat is pointed at them manually (they are *not* referenced from
`CLAUDE.md`).
**Why:** The user wants explicit control over when these are loaded, rather than having
them auto-pulled into every session via `CLAUDE.md`.

## D7 — Modular split of `app.js` (2026-10-03)
**Decision:** Split the monolithic `app.js` into `core` / `scoring` / `storage` /
`rendering` / `app` (+ existing `spots.js`), loaded as **classic `<script>` tags sharing
one global scope** in dependency order (`spots → core → scoring → storage → rendering →
app`).
**Why:** Maintainability before the UI/PWA redesign, without a build step. Classic
scripts preserve the existing runtime exactly (all top-level executable code stays in
`app.js`, which loads last), keeping the app beginner-readable and Live-Server-friendly.
**Alternatives:** ES modules (`import`/`export`) — rejected for now because it would mean
converting `spots.js`, handling the Leaflet `L` global, and a larger behavior change.
Noted as a possible future step if real encapsulation is wanted.
**Reverses if:** we adopt a bundler or move to ES modules.

## D6 — Moon/solunar time-zone alignment (2026-10-03)
**Decision:** Compute the spot's UTC offset from Open-Meteo's `utc_offset_seconds`
(because weather uses `timezone=auto`), convert to hours, and pass it to USNO as the
`tz` parameter. USNO then returns moonrise/moonset in the **spot's local time**, and we
build tz-naive local ISO strings (`YYYY-MM-DDThh:mm`) that line up with Open-Meteo's
local hourly times. Display stays in spot-local time.
**Why:** Previously USNO was effectively queried at `tz=0` (UTC) while weather was
spot-local, so solunar windows and moon-based BiteScore boosts could be shifted by hours.
Both data sets now share one local basis, independent of the **browser's** time zone
(important for spots in a different zone than the user).
**Key code:** `getForecast` (offset calc) → `fetchMoonDataForDate(…, tzHours)` in
`app.js`; `buildLocalIsoFromDateAndUsnoTime` / `normalizeUsnoTimeString` in `core.js`.

## D5 — Resilient loading: weather required, moon optional (2026-10-03)
**Decision:** Weather failure keeps the existing hard-error behavior. Moon failure is
non-fatal: render the full weather forecast, set moon fields to "Unavailable", give
moon/solunar a **neutral score of 0**, show a small non-alarming note, and suppress
misleading moon reasons. Both API calls use 12s `AbortController` timeouts. The forecast
button is disabled while loading to prevent duplicate requests.
**Why:** The app should stay useful when the secondary (moon) source is down or slow,
and shouldn't hang on a stalled request or double-fire on a double-click.

## D4 — Forecast cache with staleness, as a fallback only (2026-10-03)
**Decision:** After each successful forecast, save a compact snapshot in localStorage
keyed by spot ID + date + cache schema version. On network failure, fall back to a
matching cached snapshot, clearly labeled with its fetch time and a "may not reflect
current conditions" note. Staleness: **6h for today, 24h for future dates**; stale cache
is still offered as an explicit fallback but labeled as such. Cap at 24 snapshots.
**Why:** Keep the app useful in weak-service situations without ever presenting stale
data as live.

## D3 — Local backup via Export/Import, merge-only (2026-10-03)
**Decision:** Export custom spots + favorites + trip logs (plus schema version and
timestamp) to a downloadable JSON file; **built-in spots from `spots.js` are never
exported**. Import validates file shape first, rejects malformed files, merges custom
spots without duplicate IDs, merges favorites only for valid spot IDs, merges trip logs
without duplicate log IDs, and **preserves existing data (merge-only)**. A "replace"
mode is left as a future option.
**Why:** localStorage is the only store, so users need a safe backup/restore path that
can't silently clobber existing data.

## D2 — Forecast confidence from date distance only (2026-10-03)
**Decision:** Show a modest confidence badge based solely on how far the selected date is
from today: **≤2 days = High, 3–5 = Medium, 6+ = Low.** It describes *weather-forecast
certainty*, not fish activity, and **does not alter the BiteScore**.
**Why:** Weather forecasts degrade with lead time; surface that honestly without
pretending to predict fish behavior or double-counting it in the score.

---

### Earlier direction (from git history, pre-2026-10-03)

## D1c — Two-species forecast, one shared flow (v1.4.0)
**Decision:** Add largemouth bass alongside bluegill using the **same weather inputs and
helper-based architecture**, with species-specific weights (temperature, light, pressure,
wind, season). Keep a **single** hourly chart with a Bluegill | Bass toggle rather than
double bars.
**Why:** Expand scope to multi-species without duplicating pages or crowding the UI.

## D1b — Weighted, season-aware BiteScore + trip logging (v1.3.0)
**Decision:** Refactor scoring into a weighted model with per-factor helpers (time of
day, temperature, pressure stability, cloud cover, wind, moon, spot type), calibrated so
dawn/dusk starts ~6 and 9–10 only occurs when several favorable conditions stack. Add
local trip logging and an insights/accuracy view.
**Why:** Make the score explainable and tunable, and start a feedback loop from real
sessions. **Weights/thresholds are intentionally stable — don't change them without an
explicit request.**

## D1a — Vanilla, no-build, free data (foundational)
**Decision:** Static HTML/CSS/JS, no framework/build/backend; Open-Meteo for weather and
USNO for moon (both free, no key); weather + time-of-day are the primary scoring factors
with moon/solunar kept as a modest secondary influence.
**Why:** Beginner-readable, runs locally in VS Code / Live Server, no running costs.
