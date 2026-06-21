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

const MOON_SCORING = {
  fullNewBoost: 0.5,
  nearPhaseBoost: 0.25,
  majorBoost: 1,
  minorBoost: 0.5,
  overlapBoost: 0.5,
  maxTotalBoost: 1.5,
  majorWindowMinutes: 90,
  minorWindowMinutes: 60
};

function populateSpots() {
  spotSelect.innerHTML = "";

  spots.forEach((spot, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = spot.name;
    spotSelect.appendChild(option);
  });
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

function calculateBiteScore(data) {
  let score = 5;
  const reasons = [];

  const temp = data.temperature;
  const apparentTemp = data.apparentTemperature;
  const cloud = data.cloudCover;
  const wind = data.windSpeed;
  const humidity = data.relativeHumidity;
  const precipitation = data.precipitation;
  const precipProbability = data.precipitationProbability;
  const pressure = data.pressureMsl;
  const pressureTrend3h = data.pressureTrend3h;
  const shortwaveRadiation = data.shortwaveRadiation;
  const isDay = data.isDay;
  const minutesFromSunrise = data.minutesFromSunrise;
  const minutesToSunset = data.minutesToSunset;
  const hour = new Date(data.time).getHours();

  if (Math.abs(minutesFromSunrise) <= 90) {
    score += 2;
    reasons.push("Prime low-light window around sunrise.");
  }

  if (Math.abs(minutesToSunset) <= 90) {
    score += 2;
    reasons.push("Prime low-light window around sunset.");
  }

  if (hour >= 10 && hour <= 16 && isDay === 1 && shortwaveRadiation >= 600) {
    score -= 1;
    reasons.push("Bright midday sun can push bluegill tighter to cover.");
  }

  if (cloud >= 25 && cloud <= 70) {
    score += 1;
    reasons.push("Moderate cloud cover can extend feeding activity.");
  } else if (cloud > 90 && precipitation === 0) {
    score -= 1;
    reasons.push("Thick overcast without other positives may slow activity.");
  }

  if (wind >= 3 && wind <= 10) {
    score += 1;
    reasons.push("Light to moderate wind can improve feeding.");
  } else if (wind > 15) {
    score -= 1;
    reasons.push("Strong wind can make bites less predictable.");
  }

  if (temp >= 68 && temp <= 84) {
    score += 1;
    reasons.push("Water-warming air temperatures look favorable for bluegill.");
  } else if (temp < 58 || temp > 92) {
    score -= 2;
    reasons.push("Air temperature is less favorable for active feeding.");
  }

  if (apparentTemp >= 68 && apparentTemp <= 86) {
    score += 1;
    reasons.push("Feels-like conditions are in a comfortable feeding range.");
  } else if (apparentTemp > 95) {
    score -= 1;
    reasons.push("High heat can reduce comfortable shallow feeding periods.");
  }

  if (humidity >= 45 && humidity <= 80) {
    score += 0.5;
    reasons.push("Humidity suggests stable enough surface conditions.");
  }

  if (precipitation > 0 && precipitation <= 0.1) {
    score += 1;
    reasons.push("Light rain can improve activity without heavily disturbing the water.");
  } else if (precipitation > 0.3) {
    score -= 1;
    reasons.push("Heavier rain may reduce visibility and bite consistency.");
  }

  if (precipProbability >= 40 && precipProbability <= 70 && precipitation === 0) {
    score += 0.5;
    reasons.push("Pre-storm conditions can sometimes increase feeding.");
  }

  if (pressure !== null && pressure !== undefined) {
    if (pressure >= 1008 && pressure <= 1018) {
      score += 0.5;
      reasons.push("Pressure is in a relatively fishable range.");
    } else if (pressure < 1000 || pressure > 1025) {
      score -= 0.5;
      reasons.push("Pressure is on the more extreme side.");
    }
  }

  if (pressureTrend3h !== null && pressureTrend3h !== undefined) {
    if (pressureTrend3h <= -1.5) {
      score += 1;
      reasons.push("Falling pressure can improve short feeding windows.");
    } else if (pressureTrend3h >= 2.5) {
      score -= 1;
      reasons.push("Rapidly rising pressure can make fish less active.");
    } else if (pressureTrend3h > -0.75 && pressureTrend3h < 0.75) {
      score += 0.5;
      reasons.push("Stable pressure supports predictable behavior.");
    }
  }

  const phaseResult = getPhaseBoost(data.moonData?.phaseName, data.moonData?.illumination);
  score += phaseResult.boost;
  reasons.push(...phaseResult.reasons);

  const solunarResult = getSolunarBoost(data);
  score += solunarResult.boost;
  reasons.push(...solunarResult.reasons);

  score = clamp(Math.round(score), 1, 10);

  let label = "Fair";
  if (score >= 8) label = "Excellent";
  else if (score >= 6) label = "Good";
  else if (score <= 3) label = "Tough";

  return {
    score,
    label,
    reasons,
    moonBoost: clamp(phaseResult.boost + solunarResult.boost, 0, MOON_SCORING.maxTotalBoost),
    isMajorSolunar: solunarResult.isMajorSolunar,
    isMinorSolunar: solunarResult.isMinorSolunar,
    majorType: solunarResult.majorType,
    minorType: solunarResult.minorType
  };
}

function buildHourlyForecast(hourly, sunrise, sunset, moonData, solunarData, selectedDate) {
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
      solunarData
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
    let defaultBar = bars[0];

    bars.forEach(bar => {
      const barScore = Number(bar.dataset.score);
      const bestScore = Number(defaultBar.dataset.score);

      if (barScore > bestScore) {
        defaultBar = bar;
      }
    });

    defaultBar.classList.add("selected");
    renderSelectedHour(createSelectedHourObjectFromBar(defaultBar));
  }
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
    const hourlyResults = buildHourlyForecast(hourly, sunrise, sunset, moonData, solunarData, selectedDate);

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
      <p><strong>Spot:</strong> ${escapeHtml(selectedSpot.name)}</p>
      <p><strong>Forecast Date:</strong> ${new Date(`${selectedDate}T00:00:00`).toLocaleDateString()}</p>
      <p><strong>Summary Hour:</strong> ${escapeHtml(summaryHour.formattedTime)}${isTodaySelected(selectedDate) ? " (current hour if available)" : " (best hour for selected date)"}</p>
      <p><strong>Temperature:</strong> ${roundValue(summaryHour.temperature, 0)}°F</p>
      <p><strong>Feels Like:</strong> ${roundValue(summaryHour.apparentTemperature, 0)}°F</p>
      <p><strong>Cloud Cover:</strong> ${roundValue(summaryHour.cloudCover, 0)}%</p>
      <p><strong>Wind Speed:</strong> ${roundValue(summaryHour.windSpeed, 0)} mph</p>
      <p><strong>Humidity:</strong> ${roundValue(summaryHour.relativeHumidity, 0)}%</p>
      <p><strong>Rain:</strong> ${roundValue(summaryHour.precipitation, 2)} in</p>
      <p><strong>Pressure:</strong> ${roundValue(summaryHour.pressureMsl, 1)} hPa</p>
      <p><strong>Pressure Trend (3h):</strong> ${roundValue(summaryHour.pressureTrend3h, 1)} hPa</p>
      <p><strong>Sunrise:</strong> ${new Date(sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
      <p><strong>Sunset:</strong> ${new Date(sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
      <p><strong>Moon Phase:</strong> ${escapeHtml(moonData.phaseName || "Unknown")}</p>
      <p><strong>Moon Illumination:</strong> ${roundValue(moonData.illumination, 0)}%</p>
      <p><strong>Moonrise:</strong> ${formatMaybeTime(moonData.moonrise)}</p>
      <p><strong>Moonset:</strong> ${formatMaybeTime(moonData.moonset)}</p>
      <p><strong>Moon Overhead:</strong> ${moonData.transit ? formatMaybeTime(moonData.transit) : "Not provided by API today"}</p>
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

scoreHelp.classList.add("neutral-state");
populateSpots();
initializeDatePicker();
forecastBtn.addEventListener("click", getForecast);