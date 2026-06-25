const spotSelect = document.getElementById("spotSelect");
const forecastDate = document.getElementById("forecastDate");
const forecastBtn = document.getElementById("forecastBtn");
const weatherOutput = document.getElementById("weatherOutput");
const scoreOutput = document.getElementById("scoreOutput");
const scoreLabel = document.getElementById("scoreLabel");
const scoreHelp = document.getElementById("scoreHelp");
const reasonOutput = document.getElementById("reasonOutput");
const hourlyOutput = document.getElementById("hourlyOutput");
const chartTooltip = document.getElementById("chartTooltip");
const selectedHourDetails = document.getElementById("selectedHourDetails");

const MAX_FORECAST_DAYS = 16;

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

// ─── BiteScore model constants ─────────────────────────────────────────────
// Edit these values to tune the model after comparing forecasts to real results.

const SCORE_BASE = 4;

// Max points each factor can contribute (positive or negative) to the base.
// Time of day and pressure are the strongest levers by design.
const SCORE_WEIGHTS = {
  timeOfDay:   1.8,  // dawn/dusk windows vs midday heat
  pressure:    1.5,  // stability and trend
  temperature: 1.2,  // season-aware air temp suitability
  cloudCover:  0.8,  // glare and light conditions
  wind:        0.8,  // surface disturbance
  moon:        0.7,  // minor solunar nudge only
  spotType:    0.4,  // small per-type habitat adjustment
};

// Season boundaries (month numbers, 1-based)
const SEASON_MONTHS = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  fall:   [9, 10, 11],
  winter: [12, 1, 2],
};

// Temperature thresholds (°F) — adjust if you find the score is off for your water
const TEMP_CONFIG = {
  peakLow:    65,   // bottom of ideal bluegill range
  peakHigh:   82,   // top of ideal range
  coldCutoff: 50,   // below this: very sluggish
  heatCutoff: 93,   // above this: heat stress, slow bite
};

// Moon / solunar — kept intentionally modest so it never dominates the score
const MOON_SCORING = {
  fullNewBoost:       0.35,
  nearPhaseBoost:     0.15,
  majorBoost:         0.45,  // reduced from 1.0 — moon is a nudge, not a swing
  minorBoost:         0.20,
  overlapBoost:       0.15,
  maxTotalBoost:      0.70,  // hard cap before weight is applied
  majorWindowMinutes: 90,
  minorWindowMinutes: 60,
};

function populateSpots(preserveValue) {
  const prevValue = preserveValue !== undefined ? String(preserveValue) : spotSelect.value;
  spotSelect.innerHTML = "";

  const indexed = spots.map((spot, index) => ({ spot, index }));
  const favItems = indexed.filter(({ spot }) => favorites.has(spot.id));
  const restItems = indexed.filter(({ spot }) => !favorites.has(spot.id));

  function makeOption(spot, index) {
    const opt = document.createElement("option");
    opt.value = index;
    opt.textContent = spot.name;
    return opt;
  }

  if (favItems.length > 0) {
    const favGroup = document.createElement("optgroup");
    favGroup.label = "★ Favorites";
    favItems.forEach(({ spot, index }) => favGroup.appendChild(makeOption(spot, index)));
    spotSelect.appendChild(favGroup);
  }

  // Group non-favorites by normalized type
  const byType = {};
  for (const item of restItems) {
    const type = normalizeSpotType(item.spot.type);
    if (!byType[type]) byType[type] = [];
    byType[type].push(item);
  }

  for (const type of TYPE_ORDER) {
    const items = byType[type];
    if (!items || items.length === 0) continue;
    const group = document.createElement("optgroup");
    group.label = TYPE_PLURAL[type] || type;
    items.forEach(({ spot, index }) => group.appendChild(makeOption(spot, index)));
    spotSelect.appendChild(group);
  }

  // Flat fallback if no groups were added (no favorites, no typed spots)
  if (spotSelect.children.length === 0) {
    spots.forEach((spot, index) => spotSelect.appendChild(makeOption(spot, index)));
  }

  if (prevValue !== "" && prevValue != null) {
    spotSelect.value = prevValue;
    if (!spotSelect.value && spots.length > 0) spotSelect.value = "0";
  }
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

function initializeDatePicker() {
  if (!forecastDate) return;

  const today = getTodayDateString();
  const maxDate = addDays(today, MAX_FORECAST_DAYS - 1);

  forecastDate.value = today;
  forecastDate.min = today;
  forecastDate.max = maxDate;
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

function getPressureTrend(hourly, index, lookbackHours = 3) {
  const previousIndex = index - lookbackHours;
  if (previousIndex < 0) return null;

  const currentPressure = hourly.pressure_msl?.[index];
  const previousPressure = hourly.pressure_msl?.[previousIndex];

  if (
    currentPressure === undefined ||
    previousPressure === undefined ||
    currentPressure === null ||
    previousPressure === null
  ) {
    return null;
  }

  return currentPressure - previousPressure;
}

function getRollingPrecipitation(hourly, index, lookbackHours = 6) {
  let total = 0;
  const start = Math.max(0, index - lookbackHours + 1);

  for (let i = start; i <= index; i++) {
    total += hourly.precipitation?.[i] ?? 0;
  }

  return total;
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

function getPhaseBoost(phaseName = "", illumination = null) {
  const phase = phaseName.toLowerCase();
  let boost = 0;
  const reasons = [];

  const isFullLike = phase.includes("full");
  const isNewLike = phase.includes("new");

  if (isFullLike || isNewLike) {
    boost += MOON_SCORING.fullNewBoost;
    reasons.push("Moon phase is near a stronger full/new moon period.");
  } else if (illumination !== null && (illumination <= 15 || illumination >= 85)) {
    boost += MOON_SCORING.nearPhaseBoost;
    reasons.push("Moon illumination is near a stronger solunar range.");
  }

  return { boost, reasons };
}

function isWithinWindow(targetTime, centerTime, windowMinutes) {
  if (!centerTime) return false;
  return Math.abs(getMinutesDifference(targetTime, centerTime)) <= windowMinutes;
}

function buildSolunarDataForDate(dateString, moonData) {
  const moonrise = moonData.moonrise || null;
  const moonset = moonData.moonset || null;

  return {
    majorPeriods: [],
    minorPeriods: [
      moonrise
        ? {
            type: "Moonrise",
            center: moonrise,
            start: new Date(new Date(moonrise).getTime() - MOON_SCORING.minorWindowMinutes * 60000).toISOString(),
            end: new Date(new Date(moonrise).getTime() + MOON_SCORING.minorWindowMinutes * 60000).toISOString()
          }
        : null,
      moonset
        ? {
            type: "Moonset",
            center: moonset,
            start: new Date(new Date(moonset).getTime() - MOON_SCORING.minorWindowMinutes * 60000).toISOString(),
            end: new Date(new Date(moonset).getTime() + MOON_SCORING.minorWindowMinutes * 60000).toISOString()
          }
        : null
    ].filter(Boolean)
  };
}

function getSolunarBoost(data) {
  let boost = 0;
  const reasons = [];
  let isMajorSolunar = false;
  let isMinorSolunar = false;
  let majorType = "";
  let minorType = "";

  if (data.solunarData?.majorPeriods?.length) {
    for (const period of data.solunarData.majorPeriods) {
      if (isWithinWindow(data.time, period.center, MOON_SCORING.majorWindowMinutes)) {
        boost += MOON_SCORING.majorBoost;
        isMajorSolunar = true;
        majorType = period.type;
        reasons.push(`Major solunar window: ${period.type}.`);
        break;
      }
    }
  }

  if (data.solunarData?.minorPeriods?.length) {
    for (const period of data.solunarData.minorPeriods) {
      if (isWithinWindow(data.time, period.center, MOON_SCORING.minorWindowMinutes)) {
        boost += MOON_SCORING.minorBoost;
        isMinorSolunar = true;
        minorType = period.type;
        reasons.push(`Minor solunar window: ${period.type}.`);
        break;
      }
    }
  }

  const nearSunrise = Math.abs(data.minutesFromSunrise) <= 90;
  const nearSunset = Math.abs(data.minutesToSunset) <= 90;

  if (isMajorSolunar && (nearSunrise || nearSunset)) {
    boost += MOON_SCORING.overlapBoost;
    reasons.push("Major solunar timing overlaps with a low-light feeding window.");
  }

  boost = Math.min(boost, MOON_SCORING.maxTotalBoost);

  return {
    boost,
    reasons,
    isMajorSolunar,
    isMinorSolunar,
    majorType,
    minorType
  };
}

// ─── BiteScore helper functions ────────────────────────────────────────────

function getSeason(month) {
  if (SEASON_MONTHS.spring.includes(month)) return "spring";
  if (SEASON_MONTHS.summer.includes(month)) return "summer";
  if (SEASON_MONTHS.fall.includes(month))   return "fall";
  return "winter";
}

// Returns a normalized score (-1 to +1) for time of day.
// Dawn and dusk are the primary feeding windows for bluegill.
// Winter reverses the pattern — midday warmth matters more than early light.
function getTimeOfDayScore(hour, minutesFromSunrise, minutesToSunset, month) {
  const season = getSeason(month);
  const nearSunrise = Math.abs(minutesFromSunrise) <= 90;
  const nearSunset  = Math.abs(minutesToSunset)   <= 90;
  const reasons = [];
  let score = 0;

  if (nearSunrise) {
    score += 0.9;
    reasons.push("Low-light feeding window around sunrise.");
  }

  if (nearSunset) {
    score += 0.9;
    reasons.push("Low-light feeding window around sunset.");
  }

  // Soft bonus for the pre-dawn hour before sunrise kicks in
  if (!nearSunrise && hour >= 5 && hour <= 6) {
    score += 0.2;
    reasons.push("Early morning pre-dawn period.");
  }

  // Midday behavior varies by season
  if (hour >= 10 && hour <= 15) {
    if (season === "summer") {
      score -= 0.8;
      reasons.push("Midday summer heat suppresses shallow feeding.");
    } else if (season === "winter") {
      score += 0.5;
      reasons.push("Winter midday warmth is the best window for active feeding.");
    }
    // Spring and fall midday: neutral (no adjustment needed)
  }

  // Deep night — fish rest, very little surface activity
  if (hour >= 22 || hour <= 3) {
    score -= 0.35;
    reasons.push("Late night / pre-dawn hours — generally slow for bluegill.");
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Season-aware temperature score.
// Bluegill peak activity: 65–82°F. Outside that range, score slides down.
function getTemperatureScore(temp, month) {
  const season = getSeason(month);
  const reasons = [];
  let score = 0;

  if (temp >= TEMP_CONFIG.peakLow && temp <= TEMP_CONFIG.peakHigh) {
    score = 1.0;
    reasons.push("Air temperature is in the ideal bluegill activity range.");
  } else if (temp > TEMP_CONFIG.peakHigh && temp <= TEMP_CONFIG.heatCutoff) {
    // Warm but above peak — sliding penalty
    const excess = temp - TEMP_CONFIG.peakHigh;
    const range  = TEMP_CONFIG.heatCutoff - TEMP_CONFIG.peakHigh;
    score = 1.0 - (excess / range);
    if (score < 0.3) {
      reasons.push("Hot air temperature is reducing comfortable surface feeding.");
    } else {
      reasons.push("Warm air — still within a manageable range for bluegill.");
    }
  } else if (temp > TEMP_CONFIG.heatCutoff) {
    score = -1.0;
    reasons.push("Extreme heat — midday bite unlikely in shallow water.");
  } else if (temp < TEMP_CONFIG.coldCutoff) {
    score = -1.0;
    reasons.push("Cold air temperature — bluegill likely sluggish.");
  } else {
    // Cool range: 50–65°F
    const ratio = (temp - TEMP_CONFIG.coldCutoff) / (TEMP_CONFIG.peakLow - TEMP_CONFIG.coldCutoff);
    score = ratio * 0.8 - 0.3; // roughly -0.3 to +0.5
    if (season === "winter" && temp >= 56) {
      score += 0.3;
      reasons.push("Cool but relatively warm for winter — afternoon window is possible.");
    } else {
      reasons.push("Cool temperatures may slow bluegill activity.");
    }
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Rewards stable or gently building pressure. Penalizes rapid swings.
function getPressureStabilityScore(pressureMsl, pressureTrend3h) {
  const reasons = [];
  let score = 0;

  if (pressureMsl !== null && pressureMsl !== undefined) {
    if (pressureMsl >= 1010 && pressureMsl <= 1022) {
      score += 0.2; // comfortable high-pressure zone
    } else if (pressureMsl < 1000 || pressureMsl > 1026) {
      score -= 0.2;
      reasons.push("Barometric pressure is on the more extreme end.");
    }
  }

  if (pressureTrend3h !== null && pressureTrend3h !== undefined) {
    if (pressureTrend3h > -0.75 && pressureTrend3h < 0.75) {
      score += 0.8;
      reasons.push("Stable pressure — consistent, predictable feeding behavior.");
    } else if (pressureTrend3h >= 0.75 && pressureTrend3h <= 2.0) {
      score += 0.3;
      reasons.push("Slowly rising pressure — generally a positive sign.");
    } else if (pressureTrend3h < -0.75 && pressureTrend3h >= -2.0) {
      score += 0.1;
      reasons.push("Gradual pressure drop — may briefly trigger feeding before a front.");
    } else if (pressureTrend3h < -2.0) {
      score -= 0.8;
      reasons.push("Rapid pressure drop — fish may go off the bite as a front approaches.");
    } else if (pressureTrend3h > 2.0) {
      score -= 0.6;
      reasons.push("Rapidly rising pressure — fish often less active right after a front.");
    }
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Cloud cover and light conditions.
function getCloudCoverScore(cloudCover, shortwaveRadiation, isDay, hour, month) {
  const season = getSeason(month);
  const reasons = [];
  let score = 0;

  if (cloudCover >= 25 && cloudCover <= 65) {
    score = 0.8;
    reasons.push("Partly cloudy skies reduce glare and extend feeding windows.");
  } else if (cloudCover > 65 && cloudCover <= 85) {
    score = 0.3;
    reasons.push("Mostly cloudy — low-glare conditions can be productive.");
  } else if (cloudCover > 85) {
    score = -0.2;
    reasons.push("Heavy overcast without other positives may slow activity.");
  } else {
    // Clear sky — evaluate by time and season
    if (isDay === 1 && hour >= 10 && hour <= 15 && season === "summer" && shortwaveRadiation >= 600) {
      score = -0.8;
      reasons.push("Bright midday summer sun pushes bluegill tight to cover.");
    } else if (isDay === 1 && hour >= 10 && hour <= 15 && shortwaveRadiation >= 450) {
      score = -0.25;
      reasons.push("Clear midday sky reduces surface feeding comfort.");
    } else {
      score = 0.1; // clear sky at dawn/dusk or low radiation is fine
    }
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Wind score — a light breeze helps; strong wind hurts smaller water more.
function getWindScore(windSpeed, spotType) {
  const reasons = [];
  let score = 0;

  if (windSpeed >= 3 && windSpeed <= 9) {
    score = 1.0;
    reasons.push("Light breeze ripples the surface and improves feeding conditions.");
  } else if (windSpeed > 9 && windSpeed <= 14) {
    score = 0.2;
    reasons.push("Moderate wind — still fishable.");
  } else if (windSpeed > 14 && windSpeed <= 20) {
    score = -0.5;
    reasons.push("Breezy conditions can reduce bite predictability.");
  } else if (windSpeed > 20) {
    score = -1.0;
    reasons.push("Strong wind makes consistent bites difficult.");
  } else {
    score = 0.1; // calm — neutral
  }

  // Ponds and lake coves are more exposed to wind effects than larger open water
  const type = normalizeSpotType(spotType || "");
  if (score < 0 && (type === "Pond" || type === "Lake Cove")) {
    score = clamp(score * 1.25, -1, 1);
    if (windSpeed > 14) reasons.push("Wind is especially disruptive on smaller sheltered water.");
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Moon and solunar influence — minor nudge only, never the dominant factor.
// Returns a 0–1 normalized score so weight application keeps it in range.
function getMoonScore(data) {
  const phaseResult   = getPhaseBoost(data.moonData?.phaseName, data.moonData?.illumination);
  const solunarResult = getSolunarBoost(data);

  const rawBoost    = phaseResult.boost + solunarResult.boost;
  const cappedBoost = Math.min(rawBoost, MOON_SCORING.maxTotalBoost);
  const normalized  = cappedBoost / MOON_SCORING.maxTotalBoost; // 0–1

  return {
    score: normalized,
    reasons: [...phaseResult.reasons, ...solunarResult.reasons],
    moonBoost: cappedBoost,
    isMajorSolunar: solunarResult.isMajorSolunar,
    isMinorSolunar: solunarResult.isMinorSolunar,
    majorType: solunarResult.majorType,
    minorType: solunarResult.minorType
  };
}

// Small per-spot-type habitat nudge. Kept modest — not a dominant factor.
function getSpotTypeAdjustment(spotType) {
  const type = normalizeSpotType(spotType || "");
  const reasons = [];
  let score = 0;

  if (type === "Pond") {
    score = 0.2;   // warm quickly, good for panfish
  } else if (type === "Lake Cove") {
    score = 0.6;   // structure, shelter, prime bluegill habitat
  } else if (type === "Creek") {
    score = 0.0;   // neutral
  } else if (type === "River") {
    score = -0.4;  // current and depth work against bluegill feeding patterns
  } else if (type === "Boat Launch") {
    score = -0.6;  // boat traffic and noise reduce shallow bite quality
  }

  if (score >= 0.5) reasons.push(`${type} habitat tends to concentrate bluegill.`);
  else if (score <= -0.3) reasons.push(`${type} conditions can be tougher for consistent bluegill bites.`);

  return { score: clamp(score, -1, 1), reasons };
}

// ─── Main BiteScore function ────────────────────────────────────────────────
// Combines all helper scores using SCORE_WEIGHTS into a final 1–10 BiteScore.
function calculateBiteScore(data) {
  const month = new Date(data.time).getMonth() + 1;
  const hour  = new Date(data.time).getHours();

  const timeResult    = getTimeOfDayScore(hour, data.minutesFromSunrise, data.minutesToSunset, month);
  const tempResult    = getTemperatureScore(data.temperature, month);
  const pressResult   = getPressureStabilityScore(data.pressureMsl, data.pressureTrend3h);
  const cloudResult   = getCloudCoverScore(data.cloudCover, data.shortwaveRadiation, data.isDay, hour, month);
  const windResult    = getWindScore(data.windSpeed, data.spotType);
  const moonResult    = getMoonScore(data);
  const spotResult    = getSpotTypeAdjustment(data.spotType);

  const rawScore =
    SCORE_BASE +
    timeResult.score  * SCORE_WEIGHTS.timeOfDay  +
    pressResult.score * SCORE_WEIGHTS.pressure   +
    tempResult.score  * SCORE_WEIGHTS.temperature +
    cloudResult.score * SCORE_WEIGHTS.cloudCover +
    windResult.score  * SCORE_WEIGHTS.wind       +
    moonResult.score  * SCORE_WEIGHTS.moon       +
    spotResult.score  * SCORE_WEIGHTS.spotType;

  const reasons = [
    ...timeResult.reasons,
    ...tempResult.reasons,
    ...pressResult.reasons,
    ...cloudResult.reasons,
    ...windResult.reasons,
    ...moonResult.reasons,
    ...spotResult.reasons,
  ];

  const score = clamp(Math.round(rawScore), 1, 10);

  let label = "Fair";
  if (score >= 8) label = "Excellent";
  else if (score >= 6) label = "Good";
  else if (score <= 3) label = "Tough";

  return {
    score,
    label,
    reasons,
    moonBoost: moonResult.moonBoost,
    isMajorSolunar: moonResult.isMajorSolunar,
    isMinorSolunar: moonResult.isMinorSolunar,
    majorType: moonResult.majorType,
    minorType: moonResult.minorType
  };
}

function buildHourlyForecast(hourly, sunrise, sunset, moonData, solunarData, selectedDate, spotType) {
  const hourlyResults = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const timeString = hourly.time[i];
    if (!timeString.startsWith(selectedDate)) continue;

    const minutesFromSunrise = getMinutesFromEvent(timeString, sunrise);
    const minutesToSunset = getMinutesUntilEvent(sunset, timeString);

    const hourData = {
      time: timeString,
      temperature: hourly.temperature_2m[i],
      apparentTemperature: hourly.apparent_temperature[i],
      cloudCover: hourly.cloud_cover[i],
      windSpeed: hourly.wind_speed_10m[i],
      relativeHumidity: hourly.relative_humidity_2m[i],
      precipitation: hourly.precipitation[i],
      precipitationProbability: hourly.precipitation_probability[i],
      pressureMsl: hourly.pressure_msl[i],
      surfacePressure: hourly.surface_pressure[i],
      shortwaveRadiation: hourly.shortwave_radiation[i],
      isDay: hourly.is_day[i],
      minutesFromSunrise,
      minutesToSunset,
      pressureTrend3h: getPressureTrend(hourly, i, 3),
      precipLast6h: getRollingPrecipitation(hourly, i, 6),
      moonData,
      solunarData,
      spotType
    };

    const result = calculateBiteScore(hourData);

    hourlyResults.push({
      time: timeString,
      formattedTime: formatHourLabel(timeString),
      temperature: hourData.temperature,
      apparentTemperature: hourData.apparentTemperature,
      cloudCover: hourData.cloudCover,
      windSpeed: hourData.windSpeed,
      relativeHumidity: hourData.relativeHumidity,
      precipitation: hourData.precipitation,
      precipitationProbability: hourData.precipitationProbability,
      pressureMsl: hourData.pressureMsl,
      surfacePressure: hourData.surfacePressure,
      shortwaveRadiation: hourData.shortwaveRadiation,
      isDay: hourData.isDay,
      pressureTrend3h: hourData.pressureTrend3h,
      precipLast6h: hourData.precipLast6h,
      score: result.score,
      label: result.label,
      reasons: result.reasons,
      moonBoost: result.moonBoost,
      isMajorSolunar: result.isMajorSolunar,
      isMinorSolunar: result.isMinorSolunar,
      majorType: result.majorType,
      minorType: result.minorType,
      moonPhase: moonData?.phaseName || "Unknown",
      moonIllumination: moonData?.illumination,
      moonrise: moonData?.moonrise,
      moonset: moonData?.moonset,
      moonTransit: moonData?.transit
    });
  }

  return hourlyResults;
}

function getBarClass(label) {
  if (label === "Excellent" || label === "Good") return "good";
  if (label === "Fair") return "fair";
  return "tough";
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

async function fetchMoonDataForDate(lat, lon, dateString) {
  const usnoUrl =
    `https://aa.usno.navy.mil/api/rstt/oneday?date=${dateString}&coords=${lat},${lon}&tz=0&id=bluegill`;

  const response = await fetch(usnoUrl);
  const moonJson = await response.json();

  if (!response.ok) {
    throw new Error("Moon data request failed.");
  }

  const data = moonJson?.properties?.data;

  if (!data) {
    throw new Error("Moon data response was missing properties.data.");
  }

  const phaseName = data.curphase || data.closestphase?.phase || "Unknown";

  let illumination = null;
  if (data.fracillum !== undefined && data.fracillum !== null) {
    const numeric = Number(String(data.fracillum).replace("%", ""));
    illumination = Number.isNaN(numeric) ? null : numeric;
  }

  let moonrise = null;
  let moonset = null;

  const moonEvents = Array.isArray(data.moondata) ? data.moondata : [];

  for (const event of moonEvents) {
    const phen = String(event?.phen || "").toLowerCase();
    const time = event?.time || null;
    if (!time) continue;

    if (phen === "rise") {
      moonrise = buildLocalIsoFromDateAndUsnoTime(dateString, time);
    } else if (phen === "set") {
      moonset = buildLocalIsoFromDateAndUsnoTime(dateString, time);
    }
  }

  return {
    phaseName,
    illumination,
    moonrise,
    moonset,
    transit: null,
    raw: moonJson
  };
}

function showChartTooltip(bar, event) {
  if (!chartTooltip) return;

  const rawReasons = bar.dataset.reasons ? bar.dataset.reasons.split(" | ") : [];
  const reasons = rawReasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("");

  chartTooltip.innerHTML = `
    <strong>${escapeHtml(bar.dataset.time || "")}</strong>
    <div>Bite Score: ${escapeHtml(bar.dataset.score || "")} (${escapeHtml(bar.dataset.label || "")})</div>
    <div>Temp: ${escapeHtml(bar.dataset.temp || "")}°F</div>
    <div>Feels Like: ${escapeHtml(bar.dataset.apparentTemp || "")}°F</div>
    <div>Cloud Cover: ${escapeHtml(bar.dataset.cloud || "")}%</div>
    <div>Wind: ${escapeHtml(bar.dataset.wind || "")} mph</div>
    <div>Humidity: ${escapeHtml(bar.dataset.humidity || "")}%</div>
    <div>Rain: ${escapeHtml(bar.dataset.precip || "")} in</div>
    <div>Pressure: ${escapeHtml(bar.dataset.pressure || "")} hPa</div>
    <div>Pressure Trend (3h): ${escapeHtml(bar.dataset.pressureTrend || "")} hPa</div>
    <div>Moon Phase: ${escapeHtml(bar.dataset.moonPhase || "")}</div>
    <div>Moon Illumination: ${escapeHtml(bar.dataset.moonIllumination || "")}%</div>
    <div>Moon Boost: +${escapeHtml(bar.dataset.moonBoost || "0")}</div>
    <div>Solunar: ${escapeHtml(bar.dataset.solunar || "None")}</div>
    <ul>${reasons}</ul>
  `;

  chartTooltip.classList.remove("hidden");

  const tooltipWidth = 280;
  const x = Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 16);
  const y = Math.max(event.clientY - 20, 16);

  chartTooltip.style.left = `${x}px`;
  chartTooltip.style.top = `${y}px`;
}

function hideChartTooltip() {
  if (!chartTooltip) return;
  chartTooltip.classList.add("hidden");
}

function createSelectedHourObjectFromBar(bar) {
  return {
    formattedTime: bar.dataset.time,
    score: Number(bar.dataset.score),
    label: bar.dataset.label,
    temperature: bar.dataset.temp,
    apparentTemperature: bar.dataset.apparentTemp,
    cloudCover: bar.dataset.cloud,
    windSpeed: bar.dataset.wind,
    relativeHumidity: bar.dataset.humidity,
    precipitation: bar.dataset.precip,
    pressureMsl: bar.dataset.pressure,
    pressureTrend3h: bar.dataset.pressureTrend,
    moonPhase: bar.dataset.moonPhase,
    moonIllumination: bar.dataset.moonIllumination,
    moonBoost: bar.dataset.moonBoost,
    solunarLabel: bar.dataset.solunar,
    reasons: bar.dataset.reasons.split(" | ")
  };
}

function renderTempLine(hourlyResults) {
  const chart = document.getElementById("hourlyChart");
  if (!chart || !hourlyResults.length) return;

  const existing = chart.querySelector(".temp-line-svg");
  if (existing) existing.remove();

  const temps = hourlyResults.map(h => h.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const tempRange = maxTemp - minTemp || 1;

  const precips = hourlyResults.map(h => h.precipitation ?? 0);
  const maxPrecip = Math.max(...precips);
  const precipRange = maxPrecip || 1;
  const hasPrecip = maxPrecip > 0;

  const chartRect = chart.getBoundingClientRect();
  const chartHeight = chartRect.height;
  const chartWidth = chart.scrollWidth;

  // The bottom 88px of padding is reserved for the precipitation band.
  // Bars (align-items: flex-end) grow upward from the content area floor,
  // which sits 88px above the element's visual bottom — so bars never enter this band.
  const PRECIP_BAND = 80;
  const precipFloor = chartHeight - 6;       // near bottom of SVG
  const precipCeiling = precipFloor - PRECIP_BAND;  // top of precip zone

  // Temperature line spans the bar region only (above the precip band)
  const yTop = chartHeight * 0.08;
  const yBottom = precipCeiling - 10;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "temp-line-svg");
  svg.setAttribute("width", chartWidth);
  svg.setAttribute("height", chartHeight);
  svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:visible;";

  function makeGuideLine(y, color) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", 0);
    line.setAttribute("y1", y.toFixed(1));
    line.setAttribute("x2", chartWidth);
    line.setAttribute("y2", y.toFixed(1));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "3 5");
    line.setAttribute("opacity", "0.28");
    return line;
  }

  function makeTempLabel(text, y, isHigh) {
    const g = document.createElementNS(svgNS, "g");

    const pill = document.createElementNS(svgNS, "rect");
    const pillX = 4;
    const pillW = 32;
    const pillH = 16;
    const pillY = isHigh ? y - pillH - 3 : y + 3;
    pill.setAttribute("x", pillX);
    pill.setAttribute("y", pillY.toFixed(1));
    pill.setAttribute("width", pillW);
    pill.setAttribute("height", pillH);
    pill.setAttribute("rx", 4);
    pill.setAttribute("fill", "#e06040");
    pill.setAttribute("opacity", "0.15");

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", pillX + pillW / 2);
    label.setAttribute("y", (pillY + pillH * 0.72).toFixed(1));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#c04828");
    label.setAttribute("font-size", "11");
    label.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    label.setAttribute("font-weight", "700");
    label.setAttribute("opacity", "0.9");
    label.textContent = text;

    g.appendChild(pill);
    g.appendChild(label);
    return g;
  }

  const barWraps = chart.querySelectorAll(".hour-bar-wrap");
  const tempPoints = [];
  const precipTopPoints = [];

  barWraps.forEach((wrap, i) => {
    const wrapRect = wrap.getBoundingClientRect();
    const x = wrapRect.left - chartRect.left + chart.scrollLeft + wrapRect.width / 2;

    const normalizedTemp = (temps[i] - minTemp) / tempRange;
    const ty = yBottom - normalizedTemp * (yBottom - yTop);
    tempPoints.push(`${x.toFixed(1)},${ty.toFixed(1)}`);

    if (hasPrecip) {
      const normalizedPrecip = (precips[i] ?? 0) / precipRange;
      // Scale within the dedicated precip band only
      const py = precipFloor - normalizedPrecip * PRECIP_BAND;
      precipTopPoints.push([x, py]);
    }
  });

  // Faint divider line between bar zone and precip band
  const divider = document.createElementNS(svgNS, "line");
  divider.setAttribute("x1", 0);
  divider.setAttribute("y1", precipCeiling.toFixed(1));
  divider.setAttribute("x2", chartWidth);
  divider.setAttribute("y2", precipCeiling.toFixed(1));
  divider.setAttribute("stroke", "#a8c4e0");
  divider.setAttribute("stroke-width", "1");
  divider.setAttribute("opacity", "0.35");
  svg.appendChild(divider);

  // Temperature guide lines and labels
  svg.appendChild(makeGuideLine(yTop, "#e06040"));
  svg.appendChild(makeGuideLine(yBottom, "#e06040"));
  svg.appendChild(makeTempLabel(`${Math.round(maxTemp)}°`, yTop, true));
  svg.appendChild(makeTempLabel(`${Math.round(minTemp)}°`, yBottom, false));

  // Precipitation area: filled polygon inside the dedicated lower band
  if (hasPrecip) {
    const firstX = precipTopPoints[0][0];
    const lastX = precipTopPoints[precipTopPoints.length - 1][0];

    const polygonPoints = [
      `${firstX.toFixed(1)},${precipFloor.toFixed(1)}`,
      ...precipTopPoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
      `${lastX.toFixed(1)},${precipFloor.toFixed(1)}`
    ].join(" ");

    const precipArea = document.createElementNS(svgNS, "polygon");
    precipArea.setAttribute("points", polygonPoints);
    precipArea.setAttribute("fill", "#5b8fc9");
    precipArea.setAttribute("opacity", "0.22");
    svg.appendChild(precipArea);

    // Peak label just above the highest point in the band
    const maxPrecipIndex = precips.indexOf(maxPrecip);
    if (maxPrecipIndex !== -1 && precipTopPoints[maxPrecipIndex]) {
      const [peakX, peakY] = precipTopPoints[maxPrecipIndex];
      const peakLabel = document.createElementNS(svgNS, "text");
      peakLabel.setAttribute("x", (peakX + 5).toFixed(1));
      peakLabel.setAttribute("y", (peakY - 4).toFixed(1));
      peakLabel.setAttribute("fill", "#3a6fa8");
      peakLabel.setAttribute("font-size", "9.5");
      peakLabel.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
      peakLabel.setAttribute("font-weight", "600");
      peakLabel.setAttribute("opacity", "0.65");
      peakLabel.textContent = `${maxPrecip.toFixed(2)}"`;
      svg.appendChild(peakLabel);
    }
  }

  // Temperature line (drawn on top)
  const tempPolyline = document.createElementNS(svgNS, "polyline");
  tempPolyline.setAttribute("points", tempPoints.join(" "));
  tempPolyline.setAttribute("fill", "none");
  tempPolyline.setAttribute("stroke", "#e06040");
  tempPolyline.setAttribute("stroke-width", "2");
  tempPolyline.setAttribute("stroke-linecap", "round");
  tempPolyline.setAttribute("stroke-linejoin", "round");
  tempPolyline.setAttribute("opacity", "0.72");

  svg.appendChild(tempPolyline);
  chart.appendChild(svg);
}

function renderHourlyForecast(hourlyResults, selectedDate) {
  if (!hourlyResults.length) {
    hourlyOutput.innerHTML = `<p>No hourly forecast available for ${selectedDate}.</p>`;
    hideChartTooltip();
    selectedHourDetails.classList.add("empty");
    selectedHourDetails.innerHTML = "<p>No selected hour available.</p>";
    return;
  }

  const strongHours = [...hourlyResults]
    .filter(hour => hour.score >= 8)
    .sort((a, b) => a.time.localeCompare(b.time));

  const groupedWindows = [];

  for (const hour of strongHours) {
    const lastWindow = groupedWindows[groupedWindows.length - 1];

    if (!lastWindow) {
      groupedWindows.push({
        start: hour,
        end: hour,
        bestScore: hour.score,
        bestLabel: hour.label
      });
      continue;
    }

    const lastHourTime = new Date(lastWindow.end.time).getTime();
    const currentHourTime = new Date(hour.time).getTime();
    const diffInHours = (currentHourTime - lastHourTime) / (1000 * 60 * 60);

    if (diffInHours <= 1.01) {
      lastWindow.end = hour;
      if (hour.score > lastWindow.bestScore) {
        lastWindow.bestScore = hour.score;
        lastWindow.bestLabel = hour.label;
      }
    } else {
      groupedWindows.push({
        start: hour,
        end: hour,
        bestScore: hour.score,
        bestLabel: hour.label
      });
    }
  }

  const fallbackWindows = [...hourlyResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(hour => ({
      start: hour,
      end: hour,
      bestScore: hour.score,
      bestLabel: hour.label
    }));

  const windowsToShow = groupedWindows.length ? groupedWindows.slice(0, 3) : fallbackWindows;

  const dayHeading = isTodaySelected(selectedDate) ? "Best times to fish today" : `Best times to fish on ${selectedDate}`;

  const topHtml = `
    <div class="top-windows">
      <h3>${dayHeading}</h3>
      <ul class="top-windows-list">
        ${windowsToShow.map(window => {
          const sameTime = window.start.formattedTime === window.end.formattedTime;
          const timeText = sameTime
            ? window.start.formattedTime
            : `${window.start.formattedTime}–${window.end.formattedTime}`;

          const solunarText =
            window.start.isMajorSolunar
              ? ` · ${window.start.majorType}`
              : window.start.isMinorSolunar
              ? ` · ${window.start.minorType}`
              : "";

          const noteText = sameTime
            ? `${window.bestLabel} bite window${solunarText}`
            : `Strong bite window${solunarText}`;

          return `
            <li class="top-window-card">
              <div class="top-window-main">
                <div class="top-window-time">${timeText}</div>
                <div class="top-window-note">${noteText}</div>
              </div>
              <div class="top-window-score ${getBarClass(window.bestLabel)}">
                ${window.bestScore}
              </div>
            </li>
          `;
        }).join("")}
      </ul>
    </div>
  `;

  const chartHtml = `
    <div class="hourly-chart-card">
      <h3>Hourly bite chart</h3>
      <div class="chart-legend">
        <span class="chart-legend-line"></span>
        <span>Temp</span>
        <span class="chart-legend-swatch--precip"></span>
        <span>Rain</span>
      </div>
      <div class="hourly-chart" id="hourlyChart">
        ${hourlyResults.map(hour => {
          const solunarLabel = hour.isMajorSolunar
            ? hour.majorType
            : hour.isMinorSolunar
            ? hour.minorType
            : "None";

          return `
            <div class="hour-bar-wrap">
              <div class="hour-score">${hour.score}</div>
              <div
                class="hour-bar ${getBarClass(hour.label)} ${hour.isMajorSolunar ? "solunar-major" : ""} ${hour.isMinorSolunar ? "solunar-minor" : ""}"
                style="height: ${Math.max(hour.score * 18, 18)}px"
                data-time="${hour.formattedTime}"
                data-hour="${new Date(hour.time).getHours()}"
                data-score="${hour.score}"
                data-label="${hour.label}"
                data-temp="${hour.temperature}"
                data-apparent-temp="${hour.apparentTemperature}"
                data-cloud="${hour.cloudCover}"
                data-wind="${hour.windSpeed}"
                data-humidity="${hour.relativeHumidity}"
                data-precip="${roundValue(hour.precipitation, 2)}"
                data-pressure="${roundValue(hour.pressureMsl, 1)}"
                data-pressure-trend="${roundValue(hour.pressureTrend3h, 1)}"
                data-moon-phase="${hour.moonPhase}"
                data-moon-illumination="${roundValue(hour.moonIllumination, 0)}"
                data-moon-boost="${roundValue(hour.moonBoost, 2)}"
                data-solunar="${solunarLabel}"
                data-reasons="${hour.reasons.join(" | ")}"
                aria-label="${hour.formattedTime}, bite score ${hour.score}, ${hour.label}"
                tabindex="0"
              ></div>
              <div class="hour-label">${hour.formattedTime.replace(":00", "")}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  hourlyOutput.innerHTML = topHtml + chartHtml;

  const bars = document.querySelectorAll(".hour-bar");

  bars.forEach(bar => {
    bar.addEventListener("mousemove", event => showChartTooltip(bar, event));
    bar.addEventListener("mouseenter", event => showChartTooltip(bar, event));
    bar.addEventListener("mouseleave", hideChartTooltip);

    bar.addEventListener("focus", () => {
      const rect = bar.getBoundingClientRect();
      showChartTooltip(bar, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top
      });
    });

    bar.addEventListener("blur", hideChartTooltip);

    bar.addEventListener("click", () => {
      document.querySelectorAll(".hour-bar.selected").forEach(el => {
        el.classList.remove("selected");
      });

      bar.classList.add("selected");
      renderSelectedHour(createSelectedHourObjectFromBar(bar));
    });
  });

  if (bars.length > 0) {
    const currentHour = new Date().getHours();
    const barsArray = Array.from(bars);

    // Try to find the bar matching the current local hour
    let defaultBar = barsArray.find(bar => Number(bar.dataset.hour) === currentHour);

    // Fall back to the nearest upcoming hour
    if (!defaultBar) {
      defaultBar = barsArray.find(bar => Number(bar.dataset.hour) > currentHour);
    }

    // Last resort: use the first bar
    if (!defaultBar) {
      defaultBar = barsArray[0];
    }

    defaultBar.classList.add("selected");
    renderSelectedHour(createSelectedHourObjectFromBar(defaultBar));
  }

  renderTempLine(hourlyResults);
}

function updateScoreLabelStyle(label) {
  scoreLabel.classList.remove("good", "fair", "tough");

  if (label === "Excellent" || label === "Good") {
    scoreLabel.classList.add("good");
  } else if (label === "Fair") {
    scoreLabel.classList.add("fair");
  } else {
    scoreLabel.classList.add("tough");
  }
}

function updateScoreHelp(score, label, selectedDate) {
  scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");

  const futureNote = isTodaySelected(selectedDate) ? "" : " Forecast confidence is lower farther out.";

  if (label === "Excellent" || label === "Good") {
    scoreHelp.textContent = `Strong conditions — worth planning around this window.${futureNote}`;
    scoreHelp.classList.add("good-state");
  } else if (label === "Fair") {
    scoreHelp.textContent = `Decent conditions — fishable, but not peak activity.${futureNote}`;
    scoreHelp.classList.add("fair-state");
  } else if (label === "Tough" || label === "Poor") {
    scoreHelp.textContent = `Slow conditions — you may need patience or a backup plan.${futureNote}`;
    scoreHelp.classList.add("tough-state");
  } else {
    scoreHelp.textContent = "Pick a spot and load the forecast.";
    scoreHelp.classList.add("neutral-state");
  }
}

function renderSelectedHour(hour) {
  selectedHourDetails.classList.remove("empty");

  const moonIlluminationText =
    hour.moonIllumination === null || hour.moonIllumination === undefined || hour.moonIllumination === "—"
      ? "—"
      : `${hour.moonIllumination}%`;

  selectedHourDetails.innerHTML = `
    <div class="selected-hour-header">
      <div>
        <div class="selected-hour-time">${hour.formattedTime}</div>
        <div class="top-window-note">${hour.label} bite window</div>
      </div>
      <div class="selected-hour-score ${getBarClass(hour.label)}">
        ${hour.score}
      </div>
    </div>

    <div class="selected-hour-grid">
      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Temperature</div>
        <div class="selected-hour-stat-value">${hour.temperature}°F</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Feels Like</div>
        <div class="selected-hour-stat-value">${hour.apparentTemperature}°F</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Cloud Cover</div>
        <div class="selected-hour-stat-value">${hour.cloudCover}%</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Wind</div>
        <div class="selected-hour-stat-value">${hour.windSpeed} mph</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Humidity</div>
        <div class="selected-hour-stat-value">${hour.relativeHumidity}%</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Rain</div>
        <div class="selected-hour-stat-value">${hour.precipitation} in</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Pressure</div>
        <div class="selected-hour-stat-value">${hour.pressureMsl} hPa</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Pressure Trend (3h)</div>
        <div class="selected-hour-stat-value">${hour.pressureTrend3h} hPa</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Moon Phase</div>
        <div class="selected-hour-stat-value">${hour.moonPhase || "—"}</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Moon Illumination</div>
        <div class="selected-hour-stat-value">${moonIlluminationText}</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Moon Boost</div>
        <div class="selected-hour-stat-value">+${hour.moonBoost || "0"}</div>
      </div>

      <div class="selected-hour-stat">
        <div class="selected-hour-stat-label">Solunar Window</div>
        <div class="selected-hour-stat-value">${hour.solunarLabel || "None"}</div>
      </div>
    </div>

    <ul class="selected-hour-reasons">
      ${hour.reasons.map(reason => `<li>${reason}</li>`).join("")}
    </ul>
  `;
}

async function getForecast() {
  const selectedSpot = spots[Number(spotSelect.value)];
  const selectedDate = forecastDate?.value || getTodayDateString();

  hideChartTooltip();
  weatherOutput.innerHTML = "<p>Loading forecast...</p>";
  scoreOutput.textContent = "--";
  scoreLabel.textContent = "Calculating...";
  scoreLabel.classList.remove("good", "fair", "tough");
  scoreHelp.textContent = "Checking forecast conditions...";
  scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");
  scoreHelp.classList.add("neutral-state");
  reasonOutput.innerHTML = "<p>Checking conditions...</p>";
  hourlyOutput.innerHTML = "<p>Building hourly forecast...</p>";
  selectedHourDetails.classList.add("empty");
  selectedHourDetails.innerHTML = "<p>Loading selected hour...</p>";

  if (!selectedSpot) {
    weatherOutput.innerHTML = "<p>No spot was selected.</p>";
    scoreOutput.textContent = "--";
    scoreLabel.textContent = "Error";
    scoreLabel.classList.remove("good", "fair", "tough");
    scoreHelp.textContent = "Please choose a valid fishing spot.";
    scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");
    scoreHelp.classList.add("neutral-state");
    reasonOutput.innerHTML = "<p>Please choose a valid spot.</p>";
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
    selectedHourDetails.innerHTML = "<p>No selected hour available.</p>";
    return;
  }

  if (
    typeof selectedSpot.lat !== "number" ||
    typeof selectedSpot.lon !== "number" ||
    Number.isNaN(selectedSpot.lat) ||
    Number.isNaN(selectedSpot.lon)
  ) {
    weatherOutput.innerHTML = `
      <p>Spot data is missing valid coordinates.</p>
      <p><strong>Spot:</strong> ${escapeHtml(selectedSpot.name ?? "Unknown")}</p>
      <p><strong>lat:</strong> ${escapeHtml(selectedSpot.lat)}</p>
      <p><strong>lon:</strong> ${escapeHtml(selectedSpot.lon)}</p>
    `;
    scoreOutput.textContent = "--";
    scoreLabel.textContent = "Error";
    scoreLabel.classList.remove("good", "fair", "tough");
    scoreHelp.textContent = "Check your spots.js file for missing coordinates.";
    scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");
    scoreHelp.classList.add("neutral-state");
    reasonOutput.innerHTML = "<p>Check your spots.js file.</p>";
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
    selectedHourDetails.innerHTML = "<p>No selected hour available.</p>";
    return;
  }

  const forecastDays = getForecastDaysForSelectedDate(selectedDate);

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${selectedSpot.lat}` +
    `&longitude=${selectedSpot.lon}` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,is_day,shortwave_radiation` +
    `&daily=sunrise,sunset` +
    `&forecast_days=${forecastDays}` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&precipitation_unit=inch` +
    `&timezone=auto`;

  try {
    const [weatherResponse, moonData] = await Promise.all([
      fetch(weatherUrl),
      fetchMoonDataForDate(selectedSpot.lat, selectedSpot.lon, selectedDate)
    ]);

    const forecast = await weatherResponse.json();

    if (!weatherResponse.ok || forecast.error) {
      throw new Error(forecast.reason || "Forecast request failed.");
    }

    if (!forecast.hourly || !forecast.daily) {
      throw new Error("Forecast data is missing hourly or daily values.");
    }

    const hourly = forecast.hourly;
    const daily = forecast.daily;
    const dayIndex = getDayIndex(daily.time, selectedDate);

    if (dayIndex === -1) {
      throw new Error("Selected date is outside the available forecast range.");
    }

    const sunrise = daily.sunrise[dayIndex];
    const sunset = daily.sunset[dayIndex];
    const solunarData = buildSolunarDataForDate(selectedDate, moonData);
    const hourlyResults = buildHourlyForecast(hourly, sunrise, sunset, moonData, solunarData, selectedDate, selectedSpot.type);

    if (!hourlyResults.length) {
      throw new Error(`No hourly forecast available for ${selectedDate}.`);
    }

    let summaryHour = hourlyResults[0];

    if (isTodaySelected(selectedDate)) {
      const currentHourIndex = getCurrentHourIndexForDate(hourly.time, selectedDate);
      if (currentHourIndex !== -1) {
        const currentHourTime = hourly.time[currentHourIndex];
        const matchingHour = hourlyResults.find(hour => hour.time === currentHourTime);
        if (matchingHour) {
          summaryHour = matchingHour;
        }
      }
    } else {
      summaryHour = [...hourlyResults].sort((a, b) => b.score - a.score || a.time.localeCompare(b.time))[0];
    }

    const summaryResult = {
      score: summaryHour.score,
      label: summaryHour.label,
      reasons: summaryHour.reasons
    };

    weatherOutput.innerHTML = `
      <div class="forecast-meta-row">
        <div class="forecast-meta-item">
          <span class="forecast-meta-label">Spot</span>
          <span class="forecast-meta-value">${escapeHtml(selectedSpot.name)}</span>
        </div>
        <div class="forecast-meta-item">
          <span class="forecast-meta-label">Date</span>
          <span class="forecast-meta-value">${new Date(`${selectedDate}T00:00:00`).toLocaleDateString()}</span>
        </div>
        <div class="forecast-meta-item">
          <span class="forecast-meta-label">Summary hour</span>
          <span class="forecast-meta-value">${escapeHtml(summaryHour.formattedTime)} ${isTodaySelected(selectedDate) ? "(current)" : "(best)"}</span>
        </div>
      </div>
      <div class="forecast-groups">
        <div class="forecast-col">
          <div class="forecast-group">
            <div class="forecast-group-title">Weather</div>
            <div class="forecast-row"><span class="forecast-label">Temperature</span><span class="forecast-value">${roundValue(summaryHour.temperature, 0)}°F</span></div>
            <div class="forecast-row"><span class="forecast-label">Feels like</span><span class="forecast-value">${roundValue(summaryHour.apparentTemperature, 0)}°F</span></div>
            <div class="forecast-row"><span class="forecast-label">Cloud cover</span><span class="forecast-value">${roundValue(summaryHour.cloudCover, 0)}%</span></div>
            <div class="forecast-row"><span class="forecast-label">Rain</span><span class="forecast-value">${roundValue(summaryHour.precipitation, 2)} in</span></div>
            <div class="forecast-row"><span class="forecast-label">Humidity</span><span class="forecast-value">${roundValue(summaryHour.relativeHumidity, 0)}%</span></div>
            <div class="forecast-row"><span class="forecast-label">Wind</span><span class="forecast-value">${roundValue(summaryHour.windSpeed, 0)} mph</span></div>
          </div>
          <div class="forecast-group">
            <div class="forecast-group-title">Pressure</div>
            <div class="forecast-row"><span class="forecast-label">Pressure</span><span class="forecast-value">${roundValue(summaryHour.pressureMsl, 1)} hPa</span></div>
            <div class="forecast-row"><span class="forecast-label">Trend (3h)</span><span class="forecast-value">${roundValue(summaryHour.pressureTrend3h, 1)} hPa</span></div>
          </div>
        </div>
        <div class="forecast-col">
          <div class="forecast-group">
            <div class="forecast-group-title">Sun &amp; Moon</div>
            <div class="forecast-row"><span class="forecast-label">Sunrise</span><span class="forecast-value">${new Date(sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
            <div class="forecast-row"><span class="forecast-label">Sunset</span><span class="forecast-value">${new Date(sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
            <div class="forecast-row"><span class="forecast-label">Moon phase</span><span class="forecast-value">${escapeHtml(moonData.phaseName || "Unknown")}</span></div>
            <div class="forecast-row"><span class="forecast-label">Illumination</span><span class="forecast-value">${roundValue(moonData.illumination, 0)}%</span></div>
            <div class="forecast-row"><span class="forecast-label">Moonrise</span><span class="forecast-value">${formatMaybeTime(moonData.moonrise)}</span></div>
            <div class="forecast-row"><span class="forecast-label">Moonset</span><span class="forecast-value">${formatMaybeTime(moonData.moonset)}</span></div>
            <div class="forecast-row"><span class="forecast-label">Moon overhead</span><span class="forecast-value">${moonData.transit ? formatMaybeTime(moonData.transit) : "—"}</span></div>
          </div>
        </div>
      </div>
    `;

    scoreOutput.textContent = summaryResult.score;
    scoreLabel.textContent = summaryResult.label;
    updateScoreLabelStyle(summaryResult.label);
    updateScoreHelp(summaryResult.score, summaryResult.label, selectedDate);

    reasonOutput.innerHTML = `
      <ul>
        ${summaryResult.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}
      </ul>
    `;

    renderHourlyForecast(hourlyResults, selectedDate);
  } catch (error) {
    hideChartTooltip();
    weatherOutput.innerHTML = `<p>Error loading forecast.</p>`;
    scoreOutput.textContent = "--";
    scoreLabel.textContent = "Error";
    scoreLabel.classList.remove("good", "fair", "tough");
    scoreHelp.textContent = "Could not load forecast data right now.";
    scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");
    scoreHelp.classList.add("neutral-state");
    reasonOutput.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
    selectedHourDetails.classList.add("empty");
    selectedHourDetails.innerHTML = "<p>No selected hour available.</p>";
  }
}

let spotMap = null;
let spotMarker = null;

const favorites = new Set();

function loadFavorites() {
  try {
    const saved = localStorage.getItem("bluegill_favorites");
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) parsed.forEach(id => favorites.add(id));
  } catch (e) {
    console.warn("Could not load favorites:", e);
  }
}

function persistFavorites() {
  try {
    localStorage.setItem("bluegill_favorites", JSON.stringify([...favorites]));
  } catch (e) {
    console.warn("Could not save favorites:", e);
  }
}

function toggleFavorite(spotId) {
  if (favorites.has(spotId)) {
    favorites.delete(spotId);
  } else {
    favorites.add(spotId);
  }
  persistFavorites();
  const prevValue = spotSelect.value;
  populateSpots(prevValue);
  updateSpotMap();
  renderMySpotsList();
}

function openMySpotsModal() {
  const modal = document.getElementById("mySpotsModal");
  if (!modal) return;
  renderMySpotsList();
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeMySpotsModal() {
  const modal = document.getElementById("mySpotsModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

function isCustomSpot(spot) {
  return typeof spot.id === "string" && spot.id.startsWith("custom-");
}

let mySpotsActiveFilter = "All";

function renderSpotCard({ spot, index }) {
  const isFav = favorites.has(spot.id);
  const custom = isCustomSpot(spot);
  const notesHtml = spot.notes
    ? `<div class="my-spot-notes">${escapeHtml(spot.notes)}</div>`
    : "";

  return `
    <div class="my-spot-card">
      <button
        class="btn-favorite${isFav ? " active" : ""}"
        data-spot-id="${escapeHtml(spot.id)}"
        aria-label="${isFav ? "Remove from favorites" : "Add to favorites"}"
        type="button"
      >${isFav ? "★" : "☆"}</button>
      <div class="my-spot-main">
        <div class="my-spot-name">${escapeHtml(spot.name)}</div>
        <div class="my-spot-type">${escapeHtml(normalizeSpotType(spot.type))}</div>
        ${notesHtml}
      </div>
      <div class="my-spot-actions">
        <button class="btn-spot-action btn-spot-select" data-spot-index="${index}" type="button">Select</button>
        ${custom ? `
          <button class="btn-spot-action btn-spot-edit" data-spot-index="${index}" type="button">Edit</button>
          <button class="btn-spot-action btn-spot-delete" data-spot-index="${index}" type="button">Delete</button>
        ` : ""}
      </div>
    </div>
  `;
}

function renderMySpotsList() {
  const output = document.getElementById("mySpotsListOutput");
  if (!output) return;

  if (spots.length === 0) {
    output.innerHTML = "<p>No spots saved yet.</p>";
    return;
  }

  const availableTypes = getAvailableTypeFilters();
  const hasFavorites = spots.some(s => favorites.has(s.id));
  const filterOptions = ["All", ...(hasFavorites ? ["Favorites"] : []), ...availableTypes];

  // Reset active filter if it no longer applies
  if (!filterOptions.includes(mySpotsActiveFilter)) mySpotsActiveFilter = "All";

  const filterBarHtml = `
    <div class="spot-filter-bar">
      ${filterOptions.map(f => `
        <button class="spot-filter-chip${mySpotsActiveFilter === f ? " active" : ""}" data-filter="${escapeHtml(f)}" type="button">
          ${f === "Favorites" ? "★ " : ""}${escapeHtml(f)}
        </button>
      `).join("")}
    </div>
  `;

  const indexed = spots.map((spot, index) => ({ spot, index }));

  let filtered;
  if (mySpotsActiveFilter === "All") {
    filtered = indexed;
  } else if (mySpotsActiveFilter === "Favorites") {
    filtered = indexed.filter(({ spot }) => favorites.has(spot.id));
  } else {
    filtered = indexed.filter(({ spot }) => normalizeSpotType(spot.type) === mySpotsActiveFilter);
  }

  let listHtml;
  if (filtered.length === 0) {
    listHtml = `<p class="my-spots-empty">No spots in this category.</p>`;
  } else if (mySpotsActiveFilter === "All") {
    // Favorites first, then group remaining by type with section headers
    const favItems = filtered.filter(({ spot }) => favorites.has(spot.id));
    const restItems = filtered.filter(({ spot }) => !favorites.has(spot.id));

    const byType = {};
    for (const item of restItems) {
      const type = normalizeSpotType(item.spot.type);
      if (!byType[type]) byType[type] = [];
      byType[type].push(item);
    }

    let sections = "";
    if (favItems.length > 0) {
      sections += `<div class="my-spots-section-header">★ Favorites</div>`;
      sections += favItems.map(item => renderSpotCard(item)).join("");
    }
    for (const type of TYPE_ORDER) {
      const items = byType[type];
      if (!items || items.length === 0) continue;
      sections += `<div class="my-spots-section-header">${escapeHtml(TYPE_PLURAL[type] || type)}</div>`;
      sections += items.map(item => renderSpotCard(item)).join("");
    }
    listHtml = sections;
  } else {
    listHtml = filtered.map(item => renderSpotCard(item)).join("");
  }

  output.innerHTML = filterBarHtml + listHtml;

  output.querySelectorAll(".spot-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      mySpotsActiveFilter = btn.dataset.filter;
      renderMySpotsList();
    });
  });

  output.querySelectorAll(".btn-favorite").forEach(btn => {
    btn.addEventListener("click", () => toggleFavorite(btn.dataset.spotId));
  });

  output.querySelectorAll(".btn-spot-select").forEach(btn => {
    btn.addEventListener("click", () => {
      spotSelect.value = btn.dataset.spotIndex;
      updateSpotMap();
      closeMySpotsModal();
    });
  });

  output.querySelectorAll(".btn-spot-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.spotIndex);
      closeMySpotsModal();
      openAddSpotModal(idx);
    });
  });

  output.querySelectorAll(".btn-spot-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteCustomSpot(Number(btn.dataset.spotIndex)));
  });
}

function deleteCustomSpot(spotIndex) {
  const spot = spots[spotIndex];
  if (!spot || !isCustomSpot(spot)) return;

  if (!confirm(`Delete "${spot.name}"? This cannot be undone.`)) return;

  const currentValue = Number(spotSelect.value);

  spots.splice(spotIndex, 1);
  const customIdx = customSpots.findIndex(s => s.id === spot.id);
  if (customIdx !== -1) customSpots.splice(customIdx, 1);
  favorites.delete(spot.id);

  persistCustomSpots();
  persistFavorites();

  let newValue;
  if (currentValue === spotIndex) {
    newValue = 0;
  } else if (currentValue > spotIndex) {
    newValue = currentValue - 1;
  } else {
    newValue = currentValue;
  }

  populateSpots(String(newValue));
  updateSpotMap();
  renderMySpotsList();
}

function initSpotMap() {
  if (typeof L === "undefined") {
    throw new Error("Leaflet did not load.");
  }

  const first = spots[Number(spotSelect.value)];
  if (!first || typeof first.lat !== "number" || typeof first.lon !== "number") return;

  spotMap = L.map("spotMap", {
    scrollWheelZoom: false,
    zoomControl: true
  }).setView([first.lat, first.lon], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(spotMap);

  spotMarker = L.marker([first.lat, first.lon]).addTo(spotMap);
  setSpotMapLabel(first);

  // Forces Leaflet to recalculate tile layout in case the container
  // size wasn't fully settled when the map was first created.
  spotMap.invalidateSize();
}

function setSpotMapLabel(spot) {
  const label = document.getElementById("spotMapLabel");
  if (label) label.textContent = `${spot.name} · ${spot.type}`;
}

function updateSpotMap() {
  const spot = spots[Number(spotSelect.value)];
  if (!spot || typeof spot.lat !== "number" || typeof spot.lon !== "number") return;
  if (!spotMap || !spotMarker) return;
  const latlng = [spot.lat, spot.lon];
  spotMarker.setLatLng(latlng);
  spotMap.setView(latlng, 15);
  setSpotMapLabel(spot);
}

// --- Custom spots (localStorage) ---

const customSpots = [];

function loadCustomSpots() {
  try {
    const saved = localStorage.getItem("bluegill_customSpots");
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return;
    for (const spot of parsed) {
      if (spot && spot.id && spot.name) {
        customSpots.push(spot);
        spots.push(spot);
      }
    }
  } catch (e) {
    console.warn("Could not load custom spots:", e);
  }
}

function persistCustomSpots() {
  try {
    localStorage.setItem("bluegill_customSpots", JSON.stringify(customSpots));
  } catch (e) {
    console.warn("Could not save custom spots:", e);
  }
}

// --- Add / Edit Spot modal ---

let addSpotMap = null;
let addSpotPin = null;
let editingSpotIndex = null;

function initAddSpotMap() {
  if (addSpotMap) return;

  addSpotMap = L.map("addSpotMap", {
    scrollWheelZoom: true,
    zoomControl: true
  }).setView([33.11, -96.91], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(addSpotMap);

  addSpotMap.on("click", function (e) {
    const { lat, lng } = e.latlng;
    placeAddSpotPin(lat, lng);
    document.getElementById("newSpotLat").value = lat.toFixed(6);
    document.getElementById("newSpotLon").value = lng.toFixed(6);
    clearCoordError();
  });
}

function placeAddSpotPin(lat, lng) {
  if (addSpotPin) {
    addSpotPin.setLatLng([lat, lng]);
  } else {
    addSpotPin = L.marker([lat, lng]).addTo(addSpotMap);
  }
}

function openAddSpotModal(editIndex) {
  editingSpotIndex = editIndex !== undefined ? editIndex : null;

  const modal = document.getElementById("addSpotModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const titleEl = document.getElementById("addSpotTitle");
  const saveBtnEl = document.getElementById("saveNewSpot");

  if (editingSpotIndex !== null) {
    const spot = spots[editingSpotIndex];
    document.getElementById("newSpotName").value = spot.name || "";
    document.getElementById("newSpotType").value = spot.type || "";
    document.getElementById("newSpotLat").value = spot.lat || "";
    document.getElementById("newSpotLon").value = spot.lon || "";
    document.getElementById("newSpotNotes").value = spot.notes || "";
    if (titleEl) titleEl.textContent = "Edit Spot";
    if (saveBtnEl) saveBtnEl.textContent = "Save Changes";
  } else {
    document.getElementById("newSpotName").value = "";
    document.getElementById("newSpotType").value = "";
    document.getElementById("newSpotLat").value = "";
    document.getElementById("newSpotLon").value = "";
    document.getElementById("newSpotNotes").value = "";
    if (titleEl) titleEl.textContent = "Add a Spot";
    if (saveBtnEl) saveBtnEl.textContent = "Save Spot";
  }

  clearCoordError();

  if (addSpotPin) {
    addSpotPin.remove();
    addSpotPin = null;
  }

  setTimeout(() => {
    if (!addSpotMap) {
      initAddSpotMap();
    } else {
      addSpotMap.invalidateSize();
    }

    if (editingSpotIndex !== null) {
      const spot = spots[editingSpotIndex];
      if (typeof spot.lat === "number") {
        addSpotMap.setView([spot.lat, spot.lon], 14);
        placeAddSpotPin(spot.lat, spot.lon);
      }
    } else {
      const currentSpot = spots[Number(spotSelect.value)];
      if (currentSpot && typeof currentSpot.lat === "number") {
        addSpotMap.setView([currentSpot.lat, currentSpot.lon], 14);
      }
    }
  }, 60);
}

function closeAddSpotModal() {
  const modal = document.getElementById("addSpotModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

function clearCoordError() {
  const el = document.getElementById("coordError");
  if (el) {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

function showCoordError(msg) {
  const el = document.getElementById("coordError");
  if (el) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }
}

function tryUpdateMapFromInputs() {
  const latVal = parseFloat(document.getElementById("newSpotLat").value);
  const lonVal = parseFloat(document.getElementById("newSpotLon").value);
  clearCoordError();

  if (isNaN(latVal) || isNaN(lonVal)) return;

  if (latVal < -90 || latVal > 90) {
    showCoordError("Latitude must be between -90 and 90.");
    return;
  }
  if (lonVal < -180 || lonVal > 180) {
    showCoordError("Longitude must be between -180 and 180.");
    return;
  }

  if (!addSpotMap) return;
  placeAddSpotPin(latVal, lonVal);
  addSpotMap.setView([latVal, lonVal], Math.max(addSpotMap.getZoom(), 13));
}

function handleLatInput() {
  const latInput = document.getElementById("newSpotLat");
  const lonInput = document.getElementById("newSpotLon");
  const value = latInput.value.trim();

  // If a "lat, lon" pair was pasted into the lat field, split it automatically
  if (value.includes(",")) {
    const parts = value.split(",");
    if (parts.length === 2) {
      const pairLat = parseFloat(parts[0].trim());
      const pairLon = parseFloat(parts[1].trim());
      if (!isNaN(pairLat) && !isNaN(pairLon)) {
        latInput.value = pairLat.toFixed(6);
        lonInput.value = pairLon.toFixed(6);
        tryUpdateMapFromInputs();
        return;
      }
    }
  }

  tryUpdateMapFromInputs();
}

function saveNewSpot() {
  const name = document.getElementById("newSpotName").value.trim();
  const type = document.getElementById("newSpotType").value.trim();
  const latStr = document.getElementById("newSpotLat").value.trim();
  const lonStr = document.getElementById("newSpotLon").value.trim();
  const notes = document.getElementById("newSpotNotes").value.trim();

  if (!name) {
    showCoordError("Please enter a spot name.");
    document.getElementById("newSpotName").focus();
    return;
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) {
    showCoordError("Please set a location by clicking the map or entering coordinates.");
    return;
  }

  if (lat < -90 || lat > 90) {
    showCoordError("Latitude must be between -90 and 90.");
    return;
  }
  if (lon < -180 || lon > 180) {
    showCoordError("Longitude must be between -180 and 180.");
    return;
  }

  if (editingSpotIndex !== null) {
    const spot = spots[editingSpotIndex];
    spot.name = name;
    spot.type = type || "Custom";
    spot.lat = lat;
    spot.lon = lon;
    spot.notes = notes;

    const customIdx = customSpots.findIndex(s => s.id === spot.id);
    if (customIdx !== -1) customSpots[customIdx] = { ...spot };

    persistCustomSpots();
    populateSpots(String(editingSpotIndex));
    updateSpotMap();
    closeAddSpotModal();
    openMySpotsModal();
    return;
  }

  const newSpot = {
    id: "custom-" + Date.now(),
    name,
    type: type || "Custom",
    lat,
    lon,
    notes
  };

  spots.push(newSpot);
  customSpots.push(newSpot);
  persistCustomSpots();

  populateSpots();
  spotSelect.value = spots.length - 1;
  updateSpotMap();

  closeAddSpotModal();
}

document.getElementById("addSpotBtn").addEventListener("click", () => openAddSpotModal());
document.getElementById("closeAddSpot").addEventListener("click", closeAddSpotModal);
document.getElementById("cancelAddSpot").addEventListener("click", closeAddSpotModal);
document.getElementById("saveNewSpot").addEventListener("click", saveNewSpot);
document.getElementById("mySpotsBtn").addEventListener("click", openMySpotsModal);
document.getElementById("closeMySpotsBtn").addEventListener("click", closeMySpotsModal);

document.getElementById("mySpotsModal").addEventListener("click", function (e) {
  if (e.target === this) closeMySpotsModal();
});

document.getElementById("addSpotModal").addEventListener("click", function (e) {
  if (e.target === this) closeAddSpotModal();
});

document.getElementById("newSpotLat").addEventListener("input", handleLatInput);
document.getElementById("newSpotLon").addEventListener("input", tryUpdateMapFromInputs);

// --- End Add Spot ---

scoreHelp.classList.add("neutral-state");
loadFavorites();
loadCustomSpots();
populateSpots();
initializeDatePicker();

try {
  initSpotMap();
  spotSelect.addEventListener("change", updateSpotMap);
} catch (e) {
  console.warn("Spot map failed to initialize:", e);
  const mapEl = document.getElementById("spotMap");
  if (mapEl) {
    mapEl.innerHTML = '<p class="spot-map-unavailable">Map preview unavailable right now.</p>';
  }
}

// --- Trip Log ---

const tripLogs = [];

function loadTripLogs() {
  try {
    const saved = localStorage.getItem("bluegill_tripLogs");
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) parsed.forEach(e => tripLogs.push(e));
  } catch (e) {
    console.warn("Could not load trip logs:", e);
  }
}

function persistTripLogs() {
  try {
    localStorage.setItem("bluegill_tripLogs", JSON.stringify(tripLogs));
  } catch (e) {
    console.warn("Could not save trip logs:", e);
  }
}

let selectedTripResult = null;

function openLogTripModal() {
  selectedTripResult = null;

  const spot = spots[Number(spotSelect.value)];
  const date = forecastDate?.value || getTodayDateString();
  const selectedBar = document.querySelector(".hour-bar.selected");
  const time = selectedBar?.dataset?.time || "—";
  const score = selectedBar?.dataset?.score || "—";

  document.getElementById("ltSpotName").textContent = spot?.name || "—";
  document.getElementById("ltDate").textContent = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString()
    : "—";
  document.getElementById("ltTime").textContent = time;
  document.getElementById("ltScore").textContent = score;
  document.getElementById("ltFishCount").value = "";
  document.getElementById("ltNotes").value = "";
  document.getElementById("ltError").classList.add("hidden");

  document.querySelectorAll(".result-chip").forEach(c => c.classList.remove("active"));

  // Store raw values on the modal element for use when saving
  const modal = document.getElementById("logTripModal");
  modal.dataset.spotId   = spot?.id   || "";
  modal.dataset.spotName = spot?.name || "";
  modal.dataset.date     = date;
  modal.dataset.time     = time;
  modal.dataset.score    = score;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLogTripModal() {
  document.getElementById("logTripModal").classList.add("hidden");
  document.body.style.overflow = "";
}

function saveLogEntry() {
  if (!selectedTripResult) {
    document.getElementById("ltError").classList.remove("hidden");
    return;
  }

  const modal = document.getElementById("logTripModal");
  const fishCountRaw = document.getElementById("ltFishCount").value.trim();
  const fishCount = fishCountRaw !== "" ? Number(fishCountRaw) : null;

  const entry = {
    id: "log-" + Date.now(),
    spotId:          modal.dataset.spotId,
    spotName:        modal.dataset.spotName,
    date:            modal.dataset.date,
    time:            modal.dataset.time,
    forecastedScore: modal.dataset.score !== "—" ? Number(modal.dataset.score) : null,
    actualResult:    selectedTripResult,
    fishCount:       fishCount !== null && !isNaN(fishCount) && fishCount >= 0 ? fishCount : null,
    notes:           document.getElementById("ltNotes").value.trim(),
    loggedAt:        new Date().toISOString()
  };

  tripLogs.unshift(entry); // newest first
  persistTripLogs();
  closeLogTripModal();

  // Brief confirmation on the button
  const btn = document.getElementById("logTripBtn");
  if (btn) {
    const original = btn.textContent;
    btn.textContent = "✓ Saved";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2200);
  }
}

// Maps each result rating to the CSS color class used in the log list
const RESULT_COLOR = {
  Dead: "tough",
  Slow: "tough",
  Fair: "fair",
  Good: "good",
  Hot:  "good"
};

function openTripLogModal() {
  renderTripLogList();
  document.getElementById("tripLogModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeTripLogModal() {
  document.getElementById("tripLogModal").classList.add("hidden");
  document.body.style.overflow = "";
}

function renderTripLogList() {
  const output = document.getElementById("tripLogListOutput");
  if (!output) return;

  if (tripLogs.length === 0) {
    output.innerHTML = `<p class="my-spots-empty">No trips logged yet. Load a forecast, select an hour in the chart, then click "Log Trip Result."</p>`;
    return;
  }

  output.innerHTML = tripLogs.map(entry => {
    const dateStr = entry.date
      ? new Date(`${entry.date}T00:00:00`).toLocaleDateString()
      : "—";
    const scoreText = entry.forecastedScore !== null
      ? `Forecast score: ${entry.forecastedScore}`
      : "No forecast score";
    const fishText = entry.fishCount !== null ? `${entry.fishCount} fish` : "";
    const notesHtml = entry.notes
      ? `<div class="trip-log-notes">${escapeHtml(entry.notes)}</div>`
      : "";
    const colorClass = RESULT_COLOR[entry.actualResult] || "fair";

    return `
      <div class="trip-log-entry">
        <div class="trip-log-main">
          <div class="trip-log-topline">
            <span class="trip-log-spot">${escapeHtml(entry.spotName || "—")}</span>
            <span class="trip-log-meta">${escapeHtml(dateStr)} · ${escapeHtml(entry.time || "—")}</span>
          </div>
          <div class="trip-log-subline">
            <span>${escapeHtml(scoreText)}</span>
            ${fishText ? `<span>${escapeHtml(fishText)}</span>` : ""}
          </div>
          ${notesHtml}
        </div>
        <div class="trip-log-right">
          <span class="trip-log-result ${colorClass}">${escapeHtml(entry.actualResult)}</span>
          <button class="btn-spot-delete" data-log-id="${escapeHtml(entry.id)}" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  output.querySelectorAll("[data-log-id]").forEach(btn => {
    btn.addEventListener("click", () => deleteTripEntry(btn.dataset.logId));
  });
}

function deleteTripEntry(id) {
  const idx = tripLogs.findIndex(e => e.id === id);
  if (idx === -1) return;
  if (!confirm("Delete this trip log entry?")) return;
  tripLogs.splice(idx, 1);
  persistTripLogs();
  renderTripLogList();
}

loadTripLogs();

// --- Trip Log Insights ---

const RESULT_SCORE = { Dead: 1, Slow: 3, Fair: 5, Good: 7, Hot: 9 };
const MIN_SPOT_TRIPS = 3; // minimum entries before showing spot-level conclusions

function computeInsights() {
  const logs = tripLogs;
  if (logs.length === 0) return null;

  // Total trips
  const total = logs.length;

  // Average forecasted score (only entries that have one)
  const withForecast = logs.filter(e => e.forecastedScore !== null && !isNaN(e.forecastedScore));
  const avgForecast = withForecast.length > 0
    ? withForecast.reduce((s, e) => s + e.forecastedScore, 0) / withForecast.length
    : null;

  // Most common actual result
  const resultCounts = {};
  logs.forEach(e => {
    if (e.actualResult) resultCounts[e.actualResult] = (resultCounts[e.actualResult] || 0) + 1;
  });
  const mostCommon = Object.entries(resultCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Forecast accuracy: compare forecastedScore (0–10 scale) to result score (1–9 scale)
  // Normalize forecast to same 1–9 range for comparison
  const paired = withForecast.filter(e => RESULT_SCORE[e.actualResult] !== undefined);
  let accuracySummary = null;
  if (paired.length >= 3) {
    const diffs = paired.map(e => {
      const normalizedForecast = (e.forecastedScore / 10) * 8 + 1; // map 0–10 → 1–9
      return normalizedForecast - RESULT_SCORE[e.actualResult];
    });
    const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    if (avgDiff > 1.2) accuracySummary = "App tends to overpredict";
    else if (avgDiff < -1.2) accuracySummary = "App tends to underpredict";
    else accuracySummary = "Forecast is tracking closely";
  }

  // Per-spot summaries (only spots with MIN_SPOT_TRIPS or more entries)
  const spotMap = {};
  logs.forEach(e => {
    const key = e.spotId || e.spotName || "Unknown";
    if (!spotMap[key]) spotMap[key] = { name: e.spotName || "Unknown", entries: [] };
    spotMap[key].entries.push(e);
  });

  const spotInsights = Object.values(spotMap)
    .filter(s => s.entries.length >= MIN_SPOT_TRIPS)
    .map(s => {
      const count = s.entries.length;
      const withScore = s.entries.filter(e => e.forecastedScore !== null && !isNaN(e.forecastedScore) && RESULT_SCORE[e.actualResult] !== undefined);
      let note = null;
      if (withScore.length >= MIN_SPOT_TRIPS) {
        const avgDiff = withScore.reduce((sum, e) => {
          const norm = (e.forecastedScore / 10) * 8 + 1;
          return sum + (norm - RESULT_SCORE[e.actualResult]);
        }, 0) / withScore.length;
        if (avgDiff > 1.5) note = "Tends to fish worse than forecast";
        else if (avgDiff < -1.5) note = "Tends to fish better than forecast";
      }
      const avgActual = s.entries
        .filter(e => RESULT_SCORE[e.actualResult] !== undefined)
        .reduce((sum, e, _, arr) => sum + RESULT_SCORE[e.actualResult] / arr.length, 0);
      return { name: s.name, count, avgActual, note };
    })
    .sort((a, b) => b.avgActual - a.avgActual);

  return { total, avgForecast, mostCommon, accuracySummary, spotInsights };
}

function resultScoreToLabel(score) {
  if (score >= 8) return "Hot";
  if (score >= 6.5) return "Good";
  if (score >= 4) return "Fair";
  if (score >= 2.5) return "Slow";
  return "Dead";
}

function renderInsights() {
  const output = document.getElementById("insightsOutput");
  if (!output) return;

  const data = computeInsights();

  if (!data) {
    output.innerHTML = `
      <div class="insights-empty">
        <p class="insights-empty-title">No trips logged yet</p>
        <p class="insights-empty-body">Load a forecast, select an hour in the BiteTime chart, then tap <strong>Log Trip Result</strong> after your session. Insights will appear here after a few entries.</p>
      </div>`;
    return;
  }

  const forecastRow = data.avgForecast !== null
    ? `<div class="insight-row"><span class="insight-label">Avg forecasted score</span><span class="insight-value">${data.avgForecast.toFixed(1)} / 10</span></div>`
    : "";

  const accuracyRow = data.accuracySummary
    ? `<div class="insight-row insight-row--accent"><span class="insight-label">Forecast accuracy</span><span class="insight-value">${escapeHtml(data.accuracySummary)}</span></div>`
    : `<div class="insight-note">Log 3 or more trips with forecast scores to see accuracy tracking.</div>`;

  const spotsHtml = data.spotInsights.length > 0
    ? `<div class="insights-section-header">By spot <span class="insights-section-sub">(${MIN_SPOT_TRIPS}+ trips)</span></div>` +
      data.spotInsights.map(s => `
        <div class="insight-spot-card">
          <div class="insight-spot-name">${escapeHtml(s.name)}</div>
          <div class="insight-spot-meta">${s.count} trip${s.count !== 1 ? "s" : ""} · Avg result: <strong>${escapeHtml(resultScoreToLabel(s.avgActual))}</strong></div>
          ${s.note ? `<div class="insight-spot-note">${escapeHtml(s.note)}</div>` : ""}
        </div>`).join("")
    : `<div class="insight-note">Spot-level insights appear after logging ${MIN_SPOT_TRIPS}+ trips at the same spot.</div>`;

  output.innerHTML = `
    <div class="insights-section-header">Overall summary</div>
    <div class="insight-row"><span class="insight-label">Total logged trips</span><span class="insight-value">${data.total}</span></div>
    ${forecastRow}
    <div class="insight-row"><span class="insight-label">Most common result</span><span class="insight-value">${data.mostCommon ? escapeHtml(data.mostCommon) : "—"}</span></div>
    ${accuracyRow}
    <div class="insights-section-header" style="margin-top:1.25rem;">Spot insights</div>
    ${spotsHtml}
  `;
}

function openInsightsModal() {
  renderInsights();
  document.getElementById("insightsModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeInsightsModal() {
  document.getElementById("insightsModal").classList.add("hidden");
  document.body.style.overflow = "";
}

document.getElementById("insightsBtn").addEventListener("click", openInsightsModal);
document.getElementById("closeInsightsBtn").addEventListener("click", closeInsightsModal);
document.getElementById("insightsModal").addEventListener("click", function (e) {
  if (e.target === this) closeInsightsModal();
});

document.getElementById("logTripBtn").addEventListener("click", openLogTripModal);
document.getElementById("closeLogTrip").addEventListener("click", closeLogTripModal);
document.getElementById("cancelLogTrip").addEventListener("click", closeLogTripModal);
document.getElementById("saveLogTrip").addEventListener("click", saveLogEntry);
document.getElementById("tripLogBtn").addEventListener("click", openTripLogModal);
document.getElementById("closeTripLogBtn").addEventListener("click", closeTripLogModal);

document.getElementById("logTripModal").addEventListener("click", function (e) {
  if (e.target === this) closeLogTripModal();
});

document.getElementById("tripLogModal").addEventListener("click", function (e) {
  if (e.target === this) closeTripLogModal();
});

document.getElementById("resultChips").addEventListener("click", function (e) {
  const chip = e.target.closest(".result-chip");
  if (!chip) return;
  selectedTripResult = chip.dataset.result;
  document.querySelectorAll(".result-chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  document.getElementById("ltError").classList.add("hidden");
});

forecastBtn.addEventListener("click", getForecast);