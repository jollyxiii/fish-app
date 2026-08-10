// app.js — orchestrator: forecast fetch, map, interactive modals, and all
// event wiring / bootstrap. Loaded last so every helper is already defined.


function initializeDatePicker() {
  if (!forecastDate) return;

  const today = getTodayDateString();
  const maxDate = addDays(today, MAX_FORECAST_DAYS - 1);

  forecastDate.value = today;
  forecastDate.min = today;
  forecastDate.max = maxDate;
}

// Fetches moonrise/moonset/phase from the USNO oneday API.
//
// Time-zone handling (important): the USNO API returns rise/set/transit times in
// the time zone given by its `tz` parameter (offset in hours from UTC, positive
// east of Greenwich). The old code passed tz=0, so USNO returned UTC times that
// were then treated as local — shifting the solunar windows.
//
// We now pass `tzHours`, the fishing spot's own UTC offset for the selected date
// (read from Open-Meteo's timezone=auto response, which already accounts for DST).
// USNO then returns times on the same local wall-clock basis as the Open-Meteo
// hourly forecast, so solunar comparisons and the displayed moonrise/moonset are
// correct for the spot's location — never dependent on the browser's time zone.
async function fetchMoonDataForDate(lat, lon, dateString, tzHours = 0) {
  const usnoUrl =
    `${USNO_BASE}?date=${dateString}&coords=${lat},${lon}&tz=${tzHours}&id=bluegill`;

  const response = await fetchWithTimeout(usnoUrl);
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

async function getForecast() {
  // Guard against duplicate requests if the user double-clicks the button.
  if (forecastBtn.disabled) return;

  const originalBtnText = forecastBtn.textContent;
  forecastBtn.disabled = true;
  forecastBtn.textContent = "Loading…";

  try {
  const selectedSpot = spots[Number(spotSelect.value)];
  const selectedDate = forecastDate?.value || getTodayDateString();

  hideChartTooltip();
  weatherOutput.innerHTML = "<p>Loading forecast...</p>";
  scoreOutput.textContent = "--";
  scoreLabel.textContent = "Calculating...";
  scoreLabel.classList.remove("good", "fair", "tough");
  if (bassScoreOutput) bassScoreOutput.textContent = "--";
  if (bassScoreLabel) { bassScoreLabel.textContent = "--"; bassScoreLabel.classList.remove("good", "fair", "tough"); }
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
    if (bassScoreOutput) bassScoreOutput.textContent = "--";
    if (bassScoreLabel) { bassScoreLabel.textContent = "—"; bassScoreLabel.classList.remove("good", "fair", "tough"); }
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
    if (bassScoreOutput) bassScoreOutput.textContent = "--";
    if (bassScoreLabel) { bassScoreLabel.textContent = "—"; bassScoreLabel.classList.remove("good", "fair", "tough"); }
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
    `${OPEN_METEO_BASE}` +
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
    // ── Weather is required ──────────────────────────────────────────────
    const weatherResponse = await fetchWithTimeout(weatherUrl);
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

    // Open-Meteo (timezone=auto) reports the spot's own UTC offset for this date,
    // including DST. We reuse it so USNO moon times land on the same local
    // wall-clock basis as the hourly weather — never the browser's time zone.
    const utcOffsetSeconds = Number.isFinite(forecast.utc_offset_seconds) ? forecast.utc_offset_seconds : 0;
    const tzHours = utcOffsetSeconds / 3600;

    // ── Moon data is optional enrichment ─────────────────────────────────
    // If USNO fails, we still render the full weather forecast; moon/solunar
    // scoring becomes a neutral zero and moon fields display "Unavailable".
    let moonData = null;
    let moonAvailable = false;
    try {
      moonData = await fetchMoonDataForDate(selectedSpot.lat, selectedSpot.lon, selectedDate, tzHours);
      moonAvailable = true;
    } catch (moonError) {
      console.warn("Moon data unavailable; continuing with weather only.", moonError);
    }

    const solunarData = buildSolunarDataForDate(selectedDate, moonData);
    const hourlyResults = buildHourlyForecast(hourly, sunrise, sunset, moonData, solunarData, selectedDate, selectedSpot.type);

    if (!hourlyResults.length) {
      throw new Error(`No hourly forecast available for ${selectedDate}.`);
    }

    const fetchedAt = Date.now();

    renderForecast({
      spotName: selectedSpot.name,
      selectedDate,
      hourlyResults,
      sunrise,
      sunset,
      moonData,
      moonAvailable,
      fromCache: false,
      fetchedAt
    });

    // Save a compact snapshot so we can fall back to it if the network drops later.
    saveForecastToCache({
      key: makeCacheKey(selectedSpot.id, selectedDate),
      spotId: selectedSpot.id,
      spotName: selectedSpot.name,
      selectedDate,
      fetchedAt,
      sunrise,
      sunset,
      moonAvailable,
      moonData,
      hourlyResults
    });
  } catch (error) {
    // Weather failed → try the matching cached forecast before a hard failure.
    const cached = loadForecastFromCache(selectedSpot.id, selectedDate);
    if (cached) {
      renderForecast({
        spotName: cached.spotName || selectedSpot.name,
        selectedDate: cached.selectedDate,
        hourlyResults: cached.hourlyResults,
        sunrise: cached.sunrise,
        sunset: cached.sunset,
        moonData: cached.moonData,
        moonAvailable: cached.moonAvailable,
        fromCache: true,
        fetchedAt: cached.fetchedAt
      });
    } else {
      showForecastError(error);
    }
  }
  } finally {
    // Always re-enable the button, even after an early return above.
    forecastBtn.disabled = false;
    forecastBtn.textContent = originalBtnText;
  }
}

let spotMap = null;
let spotMarker = null;

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
  const ltSpeciesEl = document.getElementById("ltSpecies");
  if (ltSpeciesEl) ltSpeciesEl.textContent = activeSpecies === "bass" ? "Bass" : "Bluegill";
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
  modal.dataset.species  = activeSpecies;

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
    species:         modal.dataset.species || "bluegill",
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

function openTripLogModal() {
  renderTripLogList();
  document.getElementById("tripLogModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeTripLogModal() {
  document.getElementById("tripLogModal").classList.add("hidden");
  document.body.style.overflow = "";
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

document.getElementById("exportDataBtn").addEventListener("click", exportUserData);

const importDataInput = document.getElementById("importDataInput");
document.getElementById("importDataBtn").addEventListener("click", () => importDataInput.click());
importDataInput.addEventListener("change", () => {
  const file = importDataInput.files && importDataInput.files[0];
  if (file) importUserData(file);
  importDataInput.value = ""; // reset so the same file can be re-imported later
});

// Species toggle — switches the hourly chart and selected-hour card between species.
document.getElementById("speciesToggle").addEventListener("click", function (e) {
  const btn = e.target.closest(".species-toggle-btn");
  if (!btn) return;
  activeSpecies = btn.dataset.species;
  document.querySelectorAll(".species-toggle-btn").forEach(b => b.classList.toggle("active", b === btn));
  if (lastHourlyResults && lastSelectedDate) {
    hideChartTooltip();
    renderHourlyForecast(lastHourlyResults, lastSelectedDate);
  }
});

forecastBtn.addEventListener("click", getForecast);
