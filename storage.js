// storage.js — browser-local persistence: favorites, custom spots, trip logs,
// the forecast cache, and data export/import. Wraps localStorage safely.


// ─── Forecast cache (Part 3) ────────────────────────────────────────────────
// A compact snapshot of the last successful forecast per spot+date, used as a
// fallback when the network fails. Cache is never shown as if it were live.

function makeCacheKey(spotId, selectedDate) {
  // Includes the schema version so an app update can invalidate old snapshots.
  return `${CACHE_SCHEMA_VERSION}|${spotId}|${selectedDate}`;
}

function readForecastCacheStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.forecastCache);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== CACHE_SCHEMA_VERSION ||
      typeof parsed.entries !== "object" ||
      parsed.entries === null
    ) {
      return {}; // wrong shape or old schema — ignore safely
    }
    return parsed.entries;
  } catch (e) {
    console.warn("Forecast cache unreadable; ignoring.", e);
    return {};
  }
}

function writeForecastCacheStore(entries) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.forecastCache,
      JSON.stringify({ version: CACHE_SCHEMA_VERSION, entries })
    );
  } catch (e) {
    console.warn("Could not save forecast cache:", e);
  }
}

function saveForecastToCache(snapshot) {
  const entries = readForecastCacheStore();
  entries[snapshot.key] = snapshot;

  // Keep only the most recent MAX_CACHED_FORECASTS snapshots.
  const keys = Object.keys(entries);
  if (keys.length > MAX_CACHED_FORECASTS) {
    keys.sort((a, b) => (entries[a].fetchedAt || 0) - (entries[b].fetchedAt || 0));
    keys.slice(0, keys.length - MAX_CACHED_FORECASTS).forEach(k => delete entries[k]);
  }
  writeForecastCacheStore(entries);
}

function loadForecastFromCache(spotId, selectedDate) {
  const entries = readForecastCacheStore();
  const snap = entries[makeCacheKey(spotId, selectedDate)];
  if (!snap || !Array.isArray(snap.hourlyResults) || snap.hourlyResults.length === 0) {
    return null;
  }
  return snap;
}

function isForecastCacheStale(snapshot) {
  const age = Date.now() - (snapshot.fetchedAt || 0);
  const ttl = isTodaySelected(snapshot.selectedDate) ? CACHE_TTL_TODAY_MS : CACHE_TTL_FUTURE_MS;
  return age > ttl;
}

const favorites = new Set();

function loadFavorites() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.favorites);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) parsed.forEach(id => favorites.add(id));
  } catch (e) {
    console.warn("Could not load favorites:", e);
  }
}

function persistFavorites() {
  try {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...favorites]));
  } catch (e) {
    console.warn("Could not save favorites:", e);
  }
}

// --- Custom spots (localStorage) ---

const customSpots = [];

function loadCustomSpots() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.customSpots);
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
    localStorage.setItem(STORAGE_KEYS.customSpots, JSON.stringify(customSpots));
  } catch (e) {
    console.warn("Could not save custom spots:", e);
  }
}

// --- Trip Log ---

const tripLogs = [];

function loadTripLogs() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.tripLogs);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) parsed.forEach(e => tripLogs.push(e));
  } catch (e) {
    console.warn("Could not load trip logs:", e);
  }
}

function persistTripLogs() {
  try {
    localStorage.setItem(STORAGE_KEYS.tripLogs, JSON.stringify(tripLogs));
  } catch (e) {
    console.warn("Could not save trip logs:", e);
  }
}

// ─── Data backup / restore (Part 4) ────────────────────────────────────────
// Exports only browser-local user data (custom spots, favorites, trip logs).
// Built-in spots from spots.js are part of the app code and are never exported.

function exportUserData() {
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    customSpots: customSpots.map(s => ({ ...s })),
    favorites: [...favorites],
    tripLogs: tripLogs.map(t => ({ ...t }))
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `bluegill-backup-${toIsoLocalDate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Validates the overall backup file shape before we touch any current data.
function isValidBackupShape(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.customSpots) &&
    Array.isArray(obj.favorites) &&
    Array.isArray(obj.tripLogs)
  );
}

function isValidImportedSpot(s) {
  return (
    s &&
    typeof s === "object" &&
    typeof s.id === "string" && s.id &&
    typeof s.name === "string" && s.name &&
    typeof s.lat === "number" && !Number.isNaN(s.lat) &&
    typeof s.lon === "number" && !Number.isNaN(s.lon)
  );
}

function importUserData(file) {
  const reader = new FileReader();

  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (e) {
      alert("That file couldn't be read as JSON. Please choose a valid backup file.");
      return;
    }

    if (!isValidBackupShape(parsed)) {
      alert("That doesn't look like a Bluegill backup file. No changes were made.");
      return;
    }

    // Merge-only: existing data is preserved; duplicates are skipped by ID.
    const builtinIds = new Set(spots.filter(s => !isCustomSpot(s)).map(s => s.id));
    const existingCustomIds = new Set(customSpots.map(s => s.id));

    let addedSpots = 0;
    for (const raw of parsed.customSpots) {
      if (!isValidImportedSpot(raw)) continue;
      if (builtinIds.has(raw.id) || existingCustomIds.has(raw.id)) continue;
      const spot = {
        id: raw.id,
        name: raw.name,
        type: raw.type || "Custom",
        lat: raw.lat,
        lon: raw.lon,
        notes: typeof raw.notes === "string" ? raw.notes : ""
      };
      customSpots.push(spot);
      spots.push(spot);
      existingCustomIds.add(spot.id);
      addedSpots++;
    }

    // Favorites only for spot IDs that actually exist after the spot merge.
    const allSpotIds = new Set(spots.map(s => s.id));
    let addedFavs = 0;
    for (const id of parsed.favorites) {
      if (typeof id === "string" && allSpotIds.has(id) && !favorites.has(id)) {
        favorites.add(id);
        addedFavs++;
      }
    }

    // Trip logs merged without duplicate log IDs.
    const existingLogIds = new Set(tripLogs.map(t => t.id));
    let addedLogs = 0;
    for (const raw of parsed.tripLogs) {
      if (raw && typeof raw === "object" && typeof raw.id === "string" && raw.id && !existingLogIds.has(raw.id)) {
        tripLogs.push(raw);
        existingLogIds.add(raw.id);
        addedLogs++;
      }
    }
    // Keep newest-first ordering by loggedAt (matches the in-app logging order).
    tripLogs.sort((a, b) => String(b.loggedAt || "").localeCompare(String(a.loggedAt || "")));

    persistCustomSpots();
    persistFavorites();
    persistTripLogs();

    // Refresh selectors and any open lists.
    populateSpots();
    updateSpotMap();
    const mySpotsModal = document.getElementById("mySpotsModal");
    if (mySpotsModal && !mySpotsModal.classList.contains("hidden")) renderMySpotsList();
    const tripLogModal = document.getElementById("tripLogModal");
    if (tripLogModal && !tripLogModal.classList.contains("hidden")) renderTripLogList();

    alert(
      `Import complete.\n\n` +
      `Added ${addedSpots} spot${addedSpots === 1 ? "" : "s"}, ` +
      `${addedFavs} favorite${addedFavs === 1 ? "" : "s"}, ` +
      `${addedLogs} trip log${addedLogs === 1 ? "" : "s"}.\n` +
      `Existing data was preserved.`
    );
  };

  reader.onerror = () => alert("Couldn't read that file. Please try again.");
  reader.readAsText(file);
}
