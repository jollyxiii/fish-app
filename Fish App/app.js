const spotSelect = document.getElementById("spotSelect");
const forecastBtn = document.getElementById("forecastBtn");
const weatherOutput = document.getElementById("weatherOutput");
const scoreOutput = document.getElementById("scoreOutput");
const scoreLabel = document.getElementById("scoreLabel");
const reasonOutput = document.getElementById("reasonOutput");
const hourlyOutput = document.getElementById("hourlyOutput");
const chartTooltip = document.getElementById("chartTooltip");

function populateSpots() {
  spotSelect.innerHTML = "";

  spots.forEach((spot, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = spot.name;
    spotSelect.appendChild(option);
  });
}

function getCurrentHourIndex(hourlyTimes) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const currentHourString = `${year}-${month}-${day}T${hour}:00`;

  return hourlyTimes.findIndex(time => time === currentHourString);
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHourLabel(timeString) {
  return new Date(timeString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function calculateBiteScore(data, sunrise, sunset) {
  let score = 5;
  const reasons = [];

  const temp = data.temperature;
  const cloud = data.cloudCover;
  const wind = data.windSpeed;
  const time = new Date(data.time);
  const hour = time.getHours();

  const sunriseHour = new Date(sunrise).getHours();
  const sunsetHour = new Date(sunset).getHours();

  if (Math.abs(hour - sunriseHour) <= 1 || Math.abs(hour - sunsetHour) <= 1) {
    score += 2;
    reasons.push("Close to sunrise or sunset.");
  }

  if (cloud >= 30 && cloud <= 70) {
    score += 1;
    reasons.push("Moderate cloud cover helps.");
  } else if (cloud > 85) {
    score -= 1;
    reasons.push("Very heavy cloud cover may slow activity.");
  }

  if (wind >= 3 && wind <= 10) {
    score += 1;
    reasons.push("Light to moderate wind helps feeding.");
  } else if (wind > 15) {
    score -= 1;
    reasons.push("Strong wind can make feeding less predictable.");
  }

  if (temp >= 65 && temp <= 82) {
    score += 1;
    reasons.push("Temperature is favorable for bluegill.");
  } else if (temp < 55 || temp > 90) {
    score -= 2;
    reasons.push("Temperature is less favorable.");
  }

  score = Math.max(1, Math.min(10, score));

  let label = "Fair";
  if (score >= 8) label = "Excellent";
  else if (score >= 6) label = "Good";
  else if (score <= 3) label = "Tough";

  return { score, label, reasons };
}

function buildHourlyForecast(hourly, sunrise, sunset) {
  const today = getTodayDateString();
  const hourlyResults = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const timeString = hourly.time[i];

    if (!timeString.startsWith(today)) continue;

    const hourData = {
      time: timeString,
      temperature: hourly.temperature_2m[i],
      cloudCover: hourly.cloud_cover[i],
      windSpeed: hourly.wind_speed_10m[i]
    };

    const result = calculateBiteScore(hourData, sunrise, sunset);

    hourlyResults.push({
      time: timeString,
      formattedTime: formatHourLabel(timeString),
      temperature: hourData.temperature,
      cloudCover: hourData.cloudCover,
      windSpeed: hourData.windSpeed,
      score: result.score,
      label: result.label,
      reasons: result.reasons
    });
  }

  return hourlyResults;
}

function getBarClass(label) {
  if (label === "Excellent" || label === "Good") return "good";
  if (label === "Fair") return "fair";
  return "tough";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showChartTooltip(bar, event) {
  if (!chartTooltip) return;

  const rawReasons = bar.dataset.reasons ? bar.dataset.reasons.split(" | ") : [];
  const reasons = rawReasons
    .map(reason => `<li>${escapeHtml(reason)}</li>`)
    .join("");

  chartTooltip.innerHTML = `
    <strong>${escapeHtml(bar.dataset.time || "")}</strong>
    <div>Bite Score: ${escapeHtml(bar.dataset.score || "")} (${escapeHtml(bar.dataset.label || "")})</div>
    <div>Temp: ${escapeHtml(bar.dataset.temp || "")}°F</div>
    <div>Cloud Cover: ${escapeHtml(bar.dataset.cloud || "")}%</div>
    <div>Wind: ${escapeHtml(bar.dataset.wind || "")} mph</div>
    <ul>${reasons}</ul>
  `;

  chartTooltip.classList.remove("hidden");

  const tooltipWidth = 240;
  const x = Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 16);
  const y = Math.max(event.clientY - 20, 16);

  chartTooltip.style.left = `${x}px`;
  chartTooltip.style.top = `${y}px`;
}

function hideChartTooltip() {
  if (!chartTooltip) return;
  chartTooltip.classList.add("hidden");
}

function renderHourlyForecast(hourlyResults) {
  if (!hourlyResults.length) {
    hourlyOutput.innerHTML = "<p>No hourly forecast available for today.</p>";
    hideChartTooltip();
    return;
  }

const strongHours = [...hourlyResults]
  .filter(hour => hour.score >= 8)
  .sort((a, b) => a.time - b.time);

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

const topHtml = `
  <div class="top-windows">
    <h3>Best times to fish today</h3>
    <ul class="top-windows-list">
      ${windowsToShow.map(window => {
        const sameTime = window.start.formattedTime === window.end.formattedTime;
        const timeText = sameTime
          ? window.start.formattedTime
          : `${window.start.formattedTime}–${window.end.formattedTime}`;

        const noteText = sameTime
          ? `${window.bestLabel} bite window`
          : `Strong bite window`;

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
        ${hourlyResults.map(hour => `
        <div class="hour-bar-wrap">
  <div class="hour-score">${hour.score}</div>
  <div
    class="hour-bar ${getBarClass(hour.label)}"
    style="height: ${Math.max(hour.score * 18, 18)}px"
    data-time="${hour.formattedTime}"
    data-score="${hour.score}"
    data-label="${hour.label}"
    data-temp="${hour.temperature}"
    data-cloud="${hour.cloudCover}"
    data-wind="${hour.windSpeed}"
    data-reasons="${hour.reasons.join(" | ")}"
    aria-label="${hour.formattedTime}, bite score ${hour.score}, ${hour.label}"
    tabindex="0"
  ></div>
  <div class="hour-label">${hour.formattedTime.replace(":00", "")}</div>
</div>
        `).join("")}
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
  });
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

async function getForecast() {
  const selectedSpot = spots[Number(spotSelect.value)];

  hideChartTooltip();
  weatherOutput.innerHTML = "<p>Loading forecast...</p>";
  scoreOutput.textContent = "--";
  scoreLabel.textContent = "Calculating...";
  scoreLabel.classList.remove("good", "fair", "tough");
  reasonOutput.innerHTML = "<p>Checking conditions...</p>";
  hourlyOutput.innerHTML = "<p>Building hourly forecast...</p>";

  if (!selectedSpot) {
    weatherOutput.innerHTML = "<p>No spot was selected.</p>";
    scoreLabel.textContent = "Error";
    reasonOutput.innerHTML = "<p>Please choose a valid spot.</p>";
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
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
      <p><strong>Spot:</strong> ${selectedSpot.name ?? "Unknown"}</p>
      <p><strong>lat:</strong> ${selectedSpot.lat}</p>
      <p><strong>lon:</strong> ${selectedSpot.lon}</p>
    `;
    scoreOutput.textContent = "--";
    scoreLabel.textContent = "Error";
    reasonOutput.innerHTML = "<p>Check your spots.js file.</p>";
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
    return;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${selectedSpot.lat}` +
    `&longitude=${selectedSpot.lon}` +
    `&hourly=temperature_2m,cloud_cover,wind_speed_10m` +
    `&daily=sunrise,sunset` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto`;

  try {
    const response = await fetch(url);
    const forecast = await response.json();

    if (!response.ok || forecast.error) {
      throw new Error(forecast.reason || "Forecast request failed.");
    }

    if (!forecast.hourly || !forecast.daily) {
      throw new Error("Forecast data is missing hourly or daily values.");
    }

    const hourly = forecast.hourly;
    const daily = forecast.daily;
    const sunrise = daily.sunrise[0];
    const sunset = daily.sunset[0];

    const hourIndex = getCurrentHourIndex(hourly.time);

    if (hourIndex === -1) {
      throw new Error("Could not match the current hour to the forecast.");
    }

    const currentData = {
      time: hourly.time[hourIndex],
      temperature: hourly.temperature_2m[hourIndex],
      cloudCover: hourly.cloud_cover[hourIndex],
      windSpeed: hourly.wind_speed_10m[hourIndex]
    };

    const currentResult = calculateBiteScore(currentData, sunrise, sunset);
    const hourlyResults = buildHourlyForecast(hourly, sunrise, sunset);

    weatherOutput.innerHTML = `
      <p><strong>Spot:</strong> ${selectedSpot.name}</p>
      <p><strong>Forecast Time:</strong> ${new Date(currentData.time).toLocaleString()}</p>
      <p><strong>Temperature:</strong> ${currentData.temperature}°F</p>
      <p><strong>Cloud Cover:</strong> ${currentData.cloudCover}%</p>
      <p><strong>Wind Speed:</strong> ${currentData.windSpeed} mph</p>
      <p><strong>Sunrise:</strong> ${new Date(sunrise).toLocaleTimeString()}</p>
      <p><strong>Sunset:</strong> ${new Date(sunset).toLocaleTimeString()}</p>
    `;

    scoreOutput.textContent = currentResult.score;
    scoreLabel.textContent = currentResult.label;
    updateScoreLabelStyle(currentResult.label);

    reasonOutput.innerHTML = `
      <ul>
        ${currentResult.reasons.map(reason => `<li>${reason}</li>`).join("")}
      </ul>
    `;

    renderHourlyForecast(hourlyResults);
  } catch (error) {
    hideChartTooltip();
    weatherOutput.innerHTML = `<p>Error loading forecast.</p>`;
    scoreOutput.textContent = "--";
    scoreLabel.textContent = "Error";
    scoreLabel.classList.remove("good", "fair", "tough");
    reasonOutput.innerHTML = `<p>${error.message}</p>`;
    hourlyOutput.innerHTML = "<p>No hourly forecast available.</p>";
  }
}

populateSpots();
forecastBtn.addEventListener("click", getForecast);