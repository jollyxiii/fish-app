# Bluegill Bite Forecast

A browser-based fishing forecast tool that combines live weather data with solunar theory to score the best times to fish — hour by hour.

## What it does

Pick one of your saved fishing spots and a forecast date (up to 16 days out). The app pulls live weather from [Open-Meteo](https://open-meteo.com) and lunar data from the [USNO API](https://aa.usno.navy.mil/data/api), then calculates a **BiteScore** (1–10) for every hour of the day.

**Factors that go into the score:**

- Sunrise and sunset windows (low-light feeding activity)
- Temperature and feels-like temperature
- Cloud cover, wind speed, humidity
- Precipitation amount and probability
- Barometric pressure level and 3-hour trend
- Moon phase and illumination percentage
- Solunar windows — minor periods (moonrise/moonset) with overlap bonuses near dawn/dusk

The hourly chart auto-selects the best scoring hour. Hover any bar for a full tooltip, or click to pin that hour's details.

## Files

| File | Purpose |
|------|---------|
| `biteforecast.html` | App shell and layout |
| `app.js` | Forecast logic, scoring, and rendering |
| `spots.js` | Your saved fishing spots (lat/lon + notes) |
| `styles.css` | Styles |

## Adding spots

Edit `spots.js` and add an entry to the `spots` array:

```js
{
  id: "my-spot",
  name: "My Spot",
  type: "Pond",
  lat: 33.1234,
  lon: -96.5678,
  notes: "Optional notes about the spot."
}
```

## Running it

Open `biteforecast.html` directly in a browser. No build step or server required.

> Forecast accuracy drops for dates further out — the date picker warns you of this inline.
