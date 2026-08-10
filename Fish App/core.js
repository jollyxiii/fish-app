// core.js — configuration, shared constants, and low-level utilities.
// Loaded before the other app scripts; defines helpers they all rely on.


const MAX_FORECAST_DAYS = 16;

// ─── App / API configuration ───────────────────────────────────────────────
// Centralized so URLs, timeouts, cache rules, and storage keys live in one place.

const APP_VERSION = "1.5.0";              // informational; bump on notable releases
const CACHE_SCHEMA_VERSION = 1;          // forecast cache snapshot shape; bump to invalidate old caches
const BACKUP_SCHEMA_VERSION = 1;         // export/import file shape

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const USNO_BASE = "https://aa.usno.navy.mil/api/rstt/oneday";

const REQUEST_TIMEOUT_MS = 12000;        // abort external API calls that hang past this

// Cached forecasts are only used as a fallback when the network fails, but we
// still track staleness so we can tell the user the data may be out of date.
const CACHE_TTL_TODAY_MS = 6 * 60 * 60 * 1000;    // "today" goes stale after 6 hours
const CACHE_TTL_FUTURE_MS = 24 * 60 * 60 * 1000;  // future dates go stale after 24 hours
const MAX_CACHED_FORECASTS = 24;         // cap stored snapshots so localStorage stays small

// All localStorage keys in one object — never scatter raw strings around the app.
const STORAGE_KEYS = {
  favorites: "bluegill_favorites",
  customSpots: "bluegill_customSpots",
  tripLogs: "bluegill_tripLogs",
  forecastCache: "bluegill_forecastCache",
};

// Fetch wrapper that enforces a timeout via AbortController so a slow or hung
// request can't leave the UI stuck on "Loading...".
async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Spot type helpers ---

const TYPE_ORDER = ["Pond", "Lake Cove", "Creek", "River", "Boat Launch", "Other"];

const TYPE_PLURAL = {
  "Pond": "Ponds",
  "Lake Cove": "Lake Coves",
  "Creek": "Creeks",
  "River": "Rivers",
  "Boat Launch": "Boat Launches",
  "Other": "Other"
};

function normalizeSpotType(raw) {
  const lower = String(raw || "").trim().toLowerCase();
  const known = TYPE_ORDER.find(t => t.toLowerCase() === lower);
  return known || (lower ? "Other" : "Other");
}

function getAvailableTypeFilters() {
  const typeSet = new Set(spots.map(s => normalizeSpotType(s.type)));
  return TYPE_ORDER.filter(t => typeSet.has(t));
}

function toIsoLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayDateString() {
  return toIsoLocalDate(new Date());
}

function addDays(dateString, daysToAdd) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + daysToAdd);
  return toIsoLocalDate(date);
}

function getForecastDaysForSelectedDate(selectedDate) {
  const today = getTodayDateString();
  const todayDate = new Date(`${today}T00:00:00`);
  const selected = new Date(`${selectedDate}T00:00:00`);
  const diffMs = selected - todayDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return clamp(diffDays + 1, 1, MAX_FORECAST_DAYS);
}

function isTodaySelected(selectedDate) {
  return selectedDate === getTodayDateString();
}

function getCurrentHourIndexForDate(hourlyTimes, selectedDate) {
  const now = new Date();
  const currentHour = `${selectedDate}T${String(now.getHours()).padStart(2, "0")}:00`;
  return hourlyTimes.findIndex(time => time === currentHour);
}

function getDayIndex(dailyTimes, selectedDate) {
  return dailyTimes.findIndex(date => date === selectedDate);
}

function formatHourLabel(timeString) {
  return new Date(timeString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundValue(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(decimals);
}

function getMinutesDifference(a, b) {
  return Math.round((new Date(a) - new Date(b)) / 60000);
}

function getMinutesFromEvent(targetTime, eventTime) {
  return Math.round((new Date(targetTime) - new Date(eventTime)) / 60000);
}

function getMinutesUntilEvent(eventTime, targetTime) {
  return Math.round((new Date(eventTime) - new Date(targetTime)) / 60000);
}

function normalizeUsnoTimeString(value) {
  if (!value || typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();

  if (
    cleaned === "none" ||
    cleaned === "n/a" ||
    cleaned === "----" ||
    cleaned === "--:--"
  ) {
    return null;
  }

  const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = match[3];

  if (suffix) {
    const meridiem = suffix.toLowerCase();
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }

  return { hour, minute };
}

function buildLocalIsoFromDateAndUsnoTime(dateString, usnoTime) {
  const parsed = normalizeUsnoTimeString(usnoTime);
  if (!parsed) return null;

  const { hour, minute } = parsed;
  return `${dateString}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatMaybeTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function isCustomSpot(spot) {
  return typeof spot.id === "string" && spot.id.startsWith("custom-");
}
