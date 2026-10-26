# Bluegill Bite Forecast

## Project goal
A lightweight beginner-friendly fishing forecast web app focused on bluegill bite timing.

## Stack
- Static HTML, CSS, JavaScript
- No framework
- Runs locally in VS Code / Live Server
- Uses Open-Meteo forecast data
- Uses moon/solunar data as a light secondary influence

## Files
- biteforecast.html
- styles.css
- spots.js — built-in spot data
- core.js — config, shared constants, low-level utilities
- scoring.js — pure BiteScore logic (bluegill + bass)
- storage.js — localStorage persistence, forecast cache, export/import
- rendering.js — DOM references and all UI-drawing functions
- app.js — orchestrator: forecast fetch, map, modals, event wiring

The JS files are classic `<script>` tags sharing one global scope, loaded in
dependency order: spots → core → scoring → storage → rendering → app.

## Priorities
- Keep weather and time-of-day as the main scoring factors
- Keep moon and solunar influences modest
- Preserve existing app behavior unless asked to change it
- Make small, safe edits
- Explain changes clearly
- Prefer full working file edits over partial pseudocode

## Rules
- Do not add paid APIs
- Do not add heavy dependencies
- Keep the code beginner-readable
- Preserve current UI unless asked to restyle