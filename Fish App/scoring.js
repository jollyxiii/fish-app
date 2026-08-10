// scoring.js — pure BiteScore logic for bluegill and bass.
// No DOM or network access; only computes scores from weather/moon inputs.


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

// ─── Largemouth Bass scoring constants ────────────────────────────────────────
// Bass are more crepuscular and structure-oriented than bluegill.
// They tolerate a wider temperature range but shut down harder in summer midday heat.

const BASS_SCORE_BASE = 4;

const BASS_SCORE_WEIGHTS = {
  timeOfDay:   1.8,  // dawn/dusk ambush windows are critical for bass
  pressure:    1.4,  // bass respond strongly to pressure — pre-front sprees are real
  temperature: 1.2,  // season-aware; wider comfort range than bluegill
  cloudCover:  0.7,  // overcast helps, but bass tolerate bright sun better with cover
  wind:        0.6,  // less wind-sensitive than bluegill; structure absorbs disturbance
  moon:        0.5,  // minor influence
  spotType:    0.5,  // lake coves and creeks offer prime bass structure
};

const BASS_TEMP_CONFIG = {
  peakLow:    68,   // bottom of ideal bass range
  peakHigh:   84,   // top of ideal range
  coldCutoff: 50,   // below this: bass metabolism very slow
  heatCutoff: 96,   // above this: bass holding very deep
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
  // moonData may be null when the USNO request failed — treat as no solunar windows.
  const moonrise = moonData?.moonrise || null;
  const moonset = moonData?.moonset || null;

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

// ─── Bluegill BiteScore function ────────────────────────────────────────────
// Combines all helper scores using SCORE_WEIGHTS into a final 1–10 BiteScore.
function calculateBluegillBiteScore(data) {
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

// ─── Largemouth Bass scoring helpers ─────────────────────────────────────────

// Bass are ambush predators tied to dawn and dusk. Summer midday shuts them down
// harder than bluegill. Bass stay active a bit past sunrise and briefly after sunset.
function getBassTimeOfDayScore(hour, minutesFromSunrise, minutesToSunset, month) {
  const season = getSeason(month);
  const nearSunrise = Math.abs(minutesFromSunrise) <= 90;
  const nearSunset  = Math.abs(minutesToSunset)   <= 90;
  const reasons = [];
  let score = 0;

  if (nearSunrise) {
    score += 0.9;
    reasons.push("Low-light dawn window — bass are actively feeding.");
  }

  if (nearSunset) {
    score += 0.9;
    reasons.push("Dusk feeding window — prime time for bass activity.");
  }

  // Bass often stay active for 1–2 hours after sunrise before the sun gets high
  if (!nearSunrise && minutesFromSunrise > 90 && minutesFromSunrise <= 180) {
    score += 0.3;
    reasons.push("Early post-sunrise window — bass still hunting before sun gets high.");
  }

  // Brief feeding burst just after sunset as light fades
  if (!nearSunset && minutesToSunset < 0 && Math.abs(minutesToSunset) <= 60) {
    score += 0.2;
    reasons.push("Just after sunset — bass may continue feeding in fading light.");
  }

  if (hour >= 10 && hour <= 15) {
    if (season === "summer") {
      score -= 0.9;
      reasons.push("Midday summer heat — bass move deep and largely shut down.");
    } else if (season === "winter") {
      score += 0.5;
      reasons.push("Winter midday warmth brings bass into reachable feeding zones.");
    }
    // Spring and fall midday: neutral
  }

  // Late night: bass can still bite in darkness but less predictable for casual fishing
  if (hour >= 23 || hour <= 3) {
    score -= 0.2;
    reasons.push("Late night hours — bass may be active but less predictable.");
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Bass thrive in 68–84°F. Spring warm-up and fall cool-down are prime feeding periods.
function getBassTemperatureScore(temp, month) {
  const season = getSeason(month);
  const reasons = [];
  let score = 0;

  if (temp >= BASS_TEMP_CONFIG.peakLow && temp <= BASS_TEMP_CONFIG.peakHigh) {
    score = 1.0;
    reasons.push("Air temperature is in the ideal bass activity range.");
  } else if (temp > BASS_TEMP_CONFIG.peakHigh && temp <= BASS_TEMP_CONFIG.heatCutoff) {
    const excess = temp - BASS_TEMP_CONFIG.peakHigh;
    const range  = BASS_TEMP_CONFIG.heatCutoff - BASS_TEMP_CONFIG.peakHigh;
    score = 1.0 - (excess / range);
    if (score < 0.3) {
      reasons.push("Hot conditions — bass likely holding deep in cooler water.");
    } else {
      reasons.push("Warm but manageable — bass still active, likely in shaded or deeper water.");
    }
  } else if (temp > BASS_TEMP_CONFIG.heatCutoff) {
    score = -1.0;
    reasons.push("Extreme heat — bass very likely suspended deep or completely shut down.");
  } else if (temp < BASS_TEMP_CONFIG.coldCutoff) {
    score = -1.0;
    reasons.push("Cold air — bass metabolism is slow and they are largely inactive.");
  } else {
    // Cool range: 50–68°F
    const ratio = (temp - BASS_TEMP_CONFIG.coldCutoff) / (BASS_TEMP_CONFIG.peakLow - BASS_TEMP_CONFIG.coldCutoff);
    score = ratio * 0.8 - 0.3;
    if (season === "spring" && temp >= 58) {
      score += 0.35;
      reasons.push("Spring warm-up — bass moving shallow and becoming more aggressive.");
    } else if (season === "fall" && temp >= 55) {
      score += 0.25;
      reasons.push("Fall cooling — bass feeding heavily before winter; a great window.");
    } else if (season === "winter" && temp >= 56) {
      score += 0.2;
      reasons.push("Warmer winter day — afternoon bass bite is possible in shallow water.");
    } else {
      reasons.push("Cool temperatures may slow bass activity.");
    }
  }

  return { score: clamp(score, -1, 1), reasons };
}

// Bass favor structured, sheltered water. Lake coves and creek edges are ideal.
function getBassSpotTypeAdjustment(spotType) {
  const type = normalizeSpotType(spotType || "");
  const reasons = [];
  let score = 0;

  if (type === "Pond") {
    score = 0.3;   // bass can dominate ponds; good for ambush
  } else if (type === "Lake Cove") {
    score = 0.8;   // structure, shelter, fallen timber — prime bass territory
  } else if (type === "Creek") {
    score = 0.4;   // bass love current breaks and creek edges
  } else if (type === "River") {
    score = 0.1;   // bass adapt to rivers better than bluegill; neutral-to-slight positive
  } else if (type === "Boat Launch") {
    score = -0.5;  // boat traffic and disturbance push bass off
  }

  if (score >= 0.6) reasons.push(`${type} offers prime bass structure and ambush cover.`);
  else if (score >= 0.3) reasons.push(`${type} can hold good bass populations.`);
  else if (score <= -0.3) reasons.push(`${type} conditions can be disruptive for consistent bass bites.`);

  return { score: clamp(score, -1, 1), reasons };
}

// ─── Largemouth Bass BiteScore function ──────────────────────────────────────
// Uses bass-specific time-of-day, temperature, and spot-type helpers.
// Shares pressure, cloud, wind, and moon helpers with the bluegill model.
function calculateBassBiteScore(data) {
  const month = new Date(data.time).getMonth() + 1;
  const hour  = new Date(data.time).getHours();

  const timeResult  = getBassTimeOfDayScore(hour, data.minutesFromSunrise, data.minutesToSunset, month);
  const tempResult  = getBassTemperatureScore(data.temperature, month);
  const pressResult = getPressureStabilityScore(data.pressureMsl, data.pressureTrend3h);
  const cloudResult = getCloudCoverScore(data.cloudCover, data.shortwaveRadiation, data.isDay, hour, month);
  const windResult  = getWindScore(data.windSpeed, data.spotType);
  const moonResult  = getMoonScore(data);
  const spotResult  = getBassSpotTypeAdjustment(data.spotType);

  const rawScore =
    BASS_SCORE_BASE +
    timeResult.score  * BASS_SCORE_WEIGHTS.timeOfDay  +
    pressResult.score * BASS_SCORE_WEIGHTS.pressure   +
    tempResult.score  * BASS_SCORE_WEIGHTS.temperature +
    cloudResult.score * BASS_SCORE_WEIGHTS.cloudCover +
    windResult.score  * BASS_SCORE_WEIGHTS.wind       +
    moonResult.score  * BASS_SCORE_WEIGHTS.moon       +
    spotResult.score  * BASS_SCORE_WEIGHTS.spotType;

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

    const bgResult   = calculateBluegillBiteScore(hourData);
    const bassResult = calculateBassBiteScore(hourData);

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
      moonPhase: moonData?.phaseName || "Unavailable",
      moonIllumination: moonData?.illumination,
      moonrise: moonData?.moonrise,
      moonset: moonData?.moonset,
      moonTransit: moonData?.transit,
      bluegill: {
        score: bgResult.score,
        label: bgResult.label,
        reasons: bgResult.reasons,
        moonBoost: bgResult.moonBoost,
        isMajorSolunar: bgResult.isMajorSolunar,
        isMinorSolunar: bgResult.isMinorSolunar,
        majorType: bgResult.majorType,
        minorType: bgResult.minorType
      },
      bass: {
        score: bassResult.score,
        label: bassResult.label,
        reasons: bassResult.reasons,
        moonBoost: bassResult.moonBoost,
        isMajorSolunar: bassResult.isMajorSolunar,
        isMinorSolunar: bassResult.isMinorSolunar,
        majorType: bassResult.majorType,
        minorType: bassResult.minorType
      }
    });
  }

  return hourlyResults;
}
