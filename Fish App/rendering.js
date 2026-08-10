// rendering.js — DOM element references and every function that draws the UI
// (forecast summary, hourly chart, selected hour, spot lists, trip log, insights).

const spotSelect = document.getElementById("spotSelect");
const forecastDate = document.getElementById("forecastDate");
const forecastBtn = document.getElementById("forecastBtn");
const weatherOutput = document.getElementById("weatherOutput");
const scoreOutput = document.getElementById("scoreOutput");
const scoreLabel = document.getElementById("scoreLabel");
const scoreHelp = document.getElementById("scoreHelp");
const bassScoreOutput = document.getElementById("bassScoreOutput");
const bassScoreLabel = document.getElementById("bassScoreLabel");
const reasonOutput = document.getElementById("reasonOutput");
const hourlyOutput = document.getElementById("hourlyOutput");
const chartTooltip = document.getElementById("chartTooltip");
const selectedHourDetails = document.getElementById("selectedHourDetails");

// Active species for the hourly chart toggle. "bluegill" or "bass".
let activeSpecies = "bluegill";

// Stored after each successful forecast so the species toggle can re-render without re-fetching.
let lastHourlyResults = null;
let lastSelectedDate = null;

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

function getBarClass(label) {
  if (label === "Excellent" || label === "Good") return "good";
  if (label === "Fair") return "fair";
  return "tough";
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
    .filter(hour => (hour[activeSpecies]?.score ?? 0) >= 8)
    .sort((a, b) => a.time.localeCompare(b.time));

  const groupedWindows = [];

  for (const hour of strongHours) {
    const lastWindow = groupedWindows[groupedWindows.length - 1];
    const sp = hour[activeSpecies];

    if (!lastWindow) {
      groupedWindows.push({
        start: hour,
        end: hour,
        bestScore: sp.score,
        bestLabel: sp.label
      });
      continue;
    }

    const lastHourTime = new Date(lastWindow.end.time).getTime();
    const currentHourTime = new Date(hour.time).getTime();
    const diffInHours = (currentHourTime - lastHourTime) / (1000 * 60 * 60);

    if (diffInHours <= 1.01) {
      lastWindow.end = hour;
      if (sp.score > lastWindow.bestScore) {
        lastWindow.bestScore = sp.score;
        lastWindow.bestLabel = sp.label;
      }
    } else {
      groupedWindows.push({
        start: hour,
        end: hour,
        bestScore: sp.score,
        bestLabel: sp.label
      });
    }
  }

  const fallbackWindows = [...hourlyResults]
    .sort((a, b) => b[activeSpecies].score - a[activeSpecies].score)
    .slice(0, 3)
    .map(hour => ({
      start: hour,
      end: hour,
      bestScore: hour[activeSpecies].score,
      bestLabel: hour[activeSpecies].label
    }));

  const windowsToShow = groupedWindows.length ? groupedWindows.slice(0, 3) : fallbackWindows;

  const speciesName = activeSpecies === "bass" ? "Bass" : "Bluegill";
  const dayHeading = isTodaySelected(selectedDate)
    ? `Best ${speciesName} times today`
    : `Best ${speciesName} times on ${selectedDate}`;

  const topHtml = `
    <div class="top-windows">
      <h3>${dayHeading}</h3>
      <ul class="top-windows-list">
        ${windowsToShow.map(window => {
          const sp = window.start[activeSpecies];
          const sameTime = window.start.formattedTime === window.end.formattedTime;
          const timeText = sameTime
            ? window.start.formattedTime
            : `${window.start.formattedTime}–${window.end.formattedTime}`;

          const solunarText =
            sp?.isMajorSolunar
              ? ` · ${sp.majorType}`
              : sp?.isMinorSolunar
              ? ` · ${sp.minorType}`
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
          const sp = hour[activeSpecies];
          const solunarLabel = sp.isMajorSolunar
            ? sp.majorType
            : sp.isMinorSolunar
            ? sp.minorType
            : "None";

          return `
            <div class="hour-bar-wrap">
              <div class="hour-score">${sp.score}</div>
              <div
                class="hour-bar ${getBarClass(sp.label)} ${sp.isMajorSolunar ? "solunar-major" : ""} ${sp.isMinorSolunar ? "solunar-minor" : ""}"
                style="height: ${Math.max(sp.score * 18, 18)}px"
                data-time="${hour.formattedTime}"
                data-hour="${new Date(hour.time).getHours()}"
                data-score="${sp.score}"
                data-label="${sp.label}"
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
                data-moon-boost="${roundValue(sp.moonBoost, 2)}"
                data-solunar="${solunarLabel}"
                data-reasons="${sp.reasons.join(" | ")}"
                aria-label="${hour.formattedTime}, bite score ${sp.score}, ${sp.label}"
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

function updateBassScoreLabelStyle(label) {
  if (!bassScoreLabel) return;
  bassScoreLabel.classList.remove("good", "fair", "tough");
  if (label === "Excellent" || label === "Good") {
    bassScoreLabel.classList.add("good");
  } else if (label === "Fair") {
    bassScoreLabel.classList.add("fair");
  } else {
    bassScoreLabel.classList.add("tough");
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

// ─── Forecast confidence (Part 5) ──────────────────────────────────────────
// Confidence reflects how far out the weather forecast is — nothing else.
// It never changes the BiteScore; it only informs the user about forecast certainty.
function getForecastConfidence(selectedDate) {
  const today = getTodayDateString();
  const diffDays = Math.floor(
    (new Date(`${selectedDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
  );
  if (diffDays <= 2) return { level: "High", cls: "good" };
  if (diffDays <= 5) return { level: "Medium", cls: "fair" };
  return { level: "Low", cls: "tough" };
}

function formatFetchedAt(ts) {
  if (!ts) return "an earlier time";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "an earlier time";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Shared forecast rendering ──────────────────────────────────────────────
// Picks the reference "summary" hour: the current hour for today, otherwise the
// best-scoring bluegill hour (weather data is species-neutral).
function pickSummaryHour(hourlyResults, selectedDate) {
  if (!hourlyResults.length) return null;
  if (isTodaySelected(selectedDate)) {
    const now = new Date();
    const currentHourTime = `${selectedDate}T${String(now.getHours()).padStart(2, "0")}:00`;
    const match = hourlyResults.find(h => h.time === currentHourTime);
    if (match) return match;
    return hourlyResults[0];
  }
  return [...hourlyResults].sort(
    (a, b) => b.bluegill.score - a.bluegill.score || a.time.localeCompare(b.time)
  )[0];
}

// Turns a technical error into a short, user-friendly line (never a raw stack trace).
function getFriendlyErrorMessage(error) {
  if (error && error.name === "AbortError") {
    return "The request timed out. Check your connection and try again.";
  }
  const msg = error && error.message ? String(error.message) : "";
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach the forecast service. Check your connection and try again.";
  }
  // Our own thrown messages are short and safe to show; anything long/multiline is hidden.
  if (msg && msg.length < 160 && !msg.includes("\n")) return msg;
  return "Something went wrong loading the forecast. Please try again.";
}

function showForecastError(error) {
  hideChartTooltip();
  weatherOutput.innerHTML = `<p class="forecast-empty-state">Couldn't load the forecast right now.</p>`;
  scoreOutput.textContent = "--";
  scoreLabel.textContent = "Error";
  scoreLabel.classList.remove("good", "fair", "tough");
  if (bassScoreOutput) bassScoreOutput.textContent = "--";
  if (bassScoreLabel) { bassScoreLabel.textContent = "—"; bassScoreLabel.classList.remove("good", "fair", "tough"); }
  scoreHelp.textContent = "Could not load forecast data right now.";
  scoreHelp.classList.remove("good-state", "fair-state", "tough-state", "neutral-state");
  scoreHelp.classList.add("neutral-state");
  reasonOutput.innerHTML = `<p>${escapeHtml(getFriendlyErrorMessage(error))}</p>`;
  hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
  selectedHourDetails.classList.add("empty");
  selectedHourDetails.innerHTML = "<p>No selected hour available.</p>";
}

// Renders a complete forecast (summary, scores, reasons, hourly chart) from a
// normalized data object. Shared by the live path and the cached-fallback path
// so the two can never drift apart.
function renderForecast(data) {
  const {
    spotName, selectedDate, hourlyResults, sunrise, sunset,
    moonData, moonAvailable, fromCache = false, fetchedAt = null
  } = data;

  const summaryHour = pickSummaryHour(hourlyResults, selectedDate);
  if (!summaryHour) {
    showForecastError(new Error(`No hourly forecast available for ${selectedDate}.`));
    return;
  }

  const summaryResult = {
    score: summaryHour.bluegill.score,
    label: summaryHour.bluegill.label,
    reasons: summaryHour.bluegill.reasons
  };
  const bassSummaryResult = {
    score: summaryHour.bass.score,
    label: summaryHour.bass.label
  };

  const confidence = getForecastConfidence(selectedDate);

  // Moon display fields fall back to a clear "Unavailable" when USNO data failed.
  const moonPhaseText = moonAvailable ? escapeHtml(moonData?.phaseName || "Unknown") : "Unavailable";
  const moonIllumText = moonAvailable ? `${roundValue(moonData?.illumination, 0)}%` : "Unavailable";
  const moonriseText  = moonAvailable ? formatMaybeTime(moonData?.moonrise) : "Unavailable";
  const moonsetText   = moonAvailable ? formatMaybeTime(moonData?.moonset) : "Unavailable";
  const transitText   = moonAvailable && moonData?.transit ? formatMaybeTime(moonData.transit) : "—";

  const cacheBanner = fromCache ? `
    <div class="forecast-cache-banner">
      <span class="forecast-cache-dot" aria-hidden="true"></span>
      <div>
        <strong>Showing a saved forecast.</strong>
        Last refreshed ${escapeHtml(formatFetchedAt(fetchedAt))}. Live data couldn't be reached,
        so this may not reflect current conditions${isForecastCacheStale({ selectedDate, fetchedAt }) ? " and is older than the usual refresh window" : ""}.
      </div>
    </div>` : "";

  const moonNote = !moonAvailable ? `
    <p class="forecast-moon-note">Moon &amp; solunar data is temporarily unavailable, so it isn't factored into this score.</p>` : "";

  weatherOutput.innerHTML = `
    ${cacheBanner}
    <div class="forecast-meta-row">
      <div class="forecast-meta-item">
        <span class="forecast-meta-label">Spot</span>
        <span class="forecast-meta-value">${escapeHtml(spotName)}</span>
      </div>
      <div class="forecast-meta-item">
        <span class="forecast-meta-label">Date</span>
        <span class="forecast-meta-value">${new Date(`${selectedDate}T00:00:00`).toLocaleDateString()}</span>
      </div>
      <div class="forecast-meta-item">
        <span class="forecast-meta-label">Summary hour</span>
        <span class="forecast-meta-value">${escapeHtml(summaryHour.formattedTime)} ${isTodaySelected(selectedDate) ? "(current)" : "(best)"}</span>
      </div>
      <div class="forecast-meta-item">
        <span class="forecast-meta-label">Forecast confidence</span>
        <span class="forecast-meta-value forecast-confidence ${confidence.cls}">${confidence.level}</span>
      </div>
    </div>
    <p class="forecast-confidence-note">Confidence reflects how far out the weather forecast is — not a guarantee of fish activity.</p>
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
          <div class="forecast-row"><span class="forecast-label">Moon phase</span><span class="forecast-value">${moonPhaseText}</span></div>
          <div class="forecast-row"><span class="forecast-label">Illumination</span><span class="forecast-value">${moonIllumText}</span></div>
          <div class="forecast-row"><span class="forecast-label">Moonrise</span><span class="forecast-value">${moonriseText}</span></div>
          <div class="forecast-row"><span class="forecast-label">Moonset</span><span class="forecast-value">${moonsetText}</span></div>
          <div class="forecast-row"><span class="forecast-label">Moon overhead</span><span class="forecast-value">${transitText}</span></div>
        </div>
      </div>
    </div>
    ${moonNote}
  `;

  scoreOutput.textContent = summaryResult.score;
  scoreLabel.textContent = summaryResult.label;
  updateScoreLabelStyle(summaryResult.label);
  updateScoreHelp(summaryResult.score, summaryResult.label, selectedDate);

  if (bassScoreOutput) bassScoreOutput.textContent = bassSummaryResult.score;
  if (bassScoreLabel) bassScoreLabel.textContent = bassSummaryResult.label;
  updateBassScoreLabelStyle(bassSummaryResult.label);

  reasonOutput.innerHTML = `
    <ul>
      ${summaryResult.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}
    </ul>
  `;

  lastHourlyResults = hourlyResults;
  lastSelectedDate = selectedDate;
  renderHourlyForecast(hourlyResults, selectedDate);
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

// Maps each result rating to the CSS color class used in the log list
const RESULT_COLOR = {
  Dead: "tough",
  Slow: "tough",
  Fair: "fair",
  Good: "good",
  Hot:  "good"
};

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
    const speciesText = entry.species === "bass" ? "Bass" : "Bluegill";
    const scoreText = entry.forecastedScore !== null
      ? `${speciesText} forecast: ${entry.forecastedScore}`
      : `${speciesText} · No forecast score`;
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
