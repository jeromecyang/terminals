(() => {
  "use strict";

  const STORAGE_API_KEY = "historic_stations_gmaps_key";
  const STORAGE_PLACE_ID_CACHE = "historic_stations_place_id_cache_v1";
  const US_DEFAULT_CENTER = { lat: 39.5, lng: -96.5 };
  const US_DEFAULT_ZOOM = 4;

  const stations = Array.isArray(window.STATIONS_DATA) ? window.STATIONS_DATA : [];
  const config = window.APP_CONFIG || {};

  // Application state
  const state = {
    filter: "all", // "all" | "active" | "defunct"
    search: "",
    sort: "order", // "order" | "name" | "state" | "opened"
    selectedId: null,
    mapReady: false,
    activeRequestToken: 0,
  };

  // Google Maps runtime handles
  let map = null;
  let infoWindow = null;
  let PlaceClass = null;
  let AdvancedMarkerClass = null;
  let LatLngBoundsClass = null;
  const markersById = new Map();
  const placeIdCache = loadPlaceIdCache();

  // InfoWindow auto-pan & resize tracking
  let iwResizeObserver = null;
  let iwDomReadyListener = null;
  let iwMapDragListener = null;
  let iwMapWheelHandler = null;
  let iwIdleListener = null;
  let iwInitialIdleListener = null;
  let iwRafId = null;
  let iwFallbackTimer = null;
  let iwPanning = false;
  let iwPendingReposition = false;
  let iwUserInteracted = false;
  let iwPanCount = 0;

  // DOM references
  const dom = {
    app: document.getElementById("app"),
    sidebar: document.getElementById("sidebar"),
    toggleSidebarBtn: document.getElementById("toggle-sidebar-btn"),
    closeSidebarBtn: document.getElementById("close-sidebar-btn"),
    filterButtons: Array.from(document.querySelectorAll(".filter-pill")),
    countAll: document.getElementById("count-all"),
    countActive: document.getElementById("count-active"),
    countDefunct: document.getElementById("count-defunct"),
    searchInput: document.getElementById("search-input"),
    sortSelect: document.getElementById("sort-select"),
    visibleSummary: document.getElementById("visible-summary"),
    fitBoundsBtn: document.getElementById("fit-bounds-btn"),
    stationList: document.getElementById("station-list"),
    mapCanvas: document.getElementById("map"),
    setupOverlay: document.getElementById("setup-overlay"),
    setupTotalCount: document.getElementById("setup-total-count"),
    previewDotsLayer: document.getElementById("preview-dots-layer"),
    apiKeyForm: document.getElementById("api-key-form"),
    apiKeyInput: document.getElementById("api-key-input"),
    setupError: document.getElementById("setup-error"),
    apiKeyBtn: document.getElementById("api-key-btn"),
    apiKeyDialog: document.getElementById("api-key-dialog"),
    closeModalBtn: document.getElementById("close-modal-btn"),
    modalKeyForm: document.getElementById("modal-key-form"),
    modalKeyInput: document.getElementById("modal-key-input"),
    clearKeyBtn: document.getElementById("clear-key-btn"),
  };

  // =========================================================================
  // Initialization
  // =========================================================================
  function init() {
    updateCounts();
    bindUIEvents();
    renderStationList();
    renderPreviewDots();

    // Collapse sidebar by default on narrow mobile screens so map is visible first
    if (window.innerWidth <= 820) {
      setSidebarCollapsed(true);
    }

    const hasBundledKey = Boolean((config.googleMapsApiKey || "").trim());
    if (hasBundledKey && dom.apiKeyBtn) {
      dom.apiKeyBtn.hidden = true;
    }

    const apiKey = resolveApiKey();
    if (apiKey) {
      dom.setupOverlay.hidden = true;
      bootGoogleMaps(apiKey);
    } else {
      dom.setupOverlay.hidden = false;
    }
  }

  function resolveApiKey() {
    const params = new URLSearchParams(window.location.search);
    const urlKey = (params.get("key") || "").trim();
    if (urlKey) return urlKey;

    const configKey = (config.googleMapsApiKey || "").trim();
    if (configKey) return configKey;

    try {
      const savedKey = (localStorage.getItem(STORAGE_API_KEY) || "").trim();
      if (savedKey) return savedKey;
    } catch {
      // Ignore storage restrictions
    }
    return "";
  }

  function loadPlaceIdCache() {
    try {
      const raw = localStorage.getItem(STORAGE_PLACE_ID_CACHE);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function savePlaceIdToCache(stationId, placeId) {
    placeIdCache[stationId] = placeId;
    try {
      localStorage.setItem(STORAGE_PLACE_ID_CACHE, JSON.stringify(placeIdCache));
    } catch {
      // Ignore quota / privacy errors
    }
  }

  // =========================================================================
  // Filtering, Sorting & Directory Rendering
  // =========================================================================
  function updateCounts() {
    const activeCount = stations.filter((s) => s.status === "active").length;
    const defunctCount = stations.filter((s) => s.status === "defunct").length;

    dom.countAll.textContent = String(stations.length);
    dom.countActive.textContent = String(activeCount);
    dom.countDefunct.textContent = String(defunctCount);
    if (dom.setupTotalCount) {
      dom.setupTotalCount.textContent = String(stations.length);
    }
  }

  function getFilteredStations() {
    const q = state.search.trim().toLowerCase();

    const filtered = stations.filter((station) => {
      if (state.filter !== "all" && station.status !== state.filter) {
        return false;
      }
      if (!q) return true;
      const haystack = `${station.name} ${station.city} ${station.state} ${station.opened || ""}`.toLowerCase();
      return haystack.includes(q);
    });

    const sorted = [...filtered];
    switch (state.sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "state":
        sorted.sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
        break;
      case "opened":
        sorted.sort((a, b) => (parseYear(a.opened) || 9999) - (parseYear(b.opened) || 9999) || a.name.localeCompare(b.name));
        break;
      case "order":
      default:
        sorted.sort((a, b) => a.id - b.id);
        break;
    }
    return sorted;
  }

  function parseYear(val) {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const match = val.match(/\d{4}/);
      return match ? Number(match[0]) : 0;
    }
    return 0;
  }

  function renderStationList() {
    const visible = getFilteredStations();
    dom.visibleSummary.textContent =
      visible.length === stations.length
        ? `Showing all ${stations.length} stations`
        : `Showing ${visible.length} of ${stations.length} stations`;

    if (visible.length === 0) {
      dom.stationList.innerHTML = `<li class="station-empty">No stations match your filter. Try clearing the search box.</li>`;
      syncMarkerVisibility(new Set());
      return;
    }

    const fragment = document.createDocumentFragment();
    const visibleIds = new Set();

    for (const station of visible) {
      visibleIds.add(station.id);
      const li = document.createElement("li");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `station-card-btn${station.id === state.selectedId ? " is-selected" : ""}`;
      btn.dataset.stationId = String(station.id);

      const badge = document.createElement("span");
      badge.className = `station-index-badge station-index-badge--${station.status}`;
      badge.textContent = String(station.id);

      const info = document.createElement("span");
      info.className = "station-info";

      const title = document.createElement("span");
      title.className = "station-name";
      title.textContent = station.name;

      const sub = document.createElement("span");
      sub.className = "station-sub";
      const openedPart = station.opened ? `<span class="station-sub-sep">·</span><span>Opened ${escapeHtml(String(station.opened))}</span>` : "";
      sub.innerHTML = `<span>${escapeHtml(station.city)}, ${escapeHtml(station.state)}</span>${openedPart}`;

      info.appendChild(title);
      info.appendChild(sub);
      btn.appendChild(badge);
      btn.appendChild(info);

      btn.addEventListener("click", () => {
        selectStation(station.id, { fromSidebar: true });
      });

      li.appendChild(btn);
      fragment.appendChild(li);
    }

    dom.stationList.innerHTML = "";
    dom.stationList.appendChild(fragment);
    syncMarkerVisibility(visibleIds);
    syncPreviewDotsVisibility(visibleIds);
  }

  function renderPreviewDots() {
    if (!dom.previewDotsLayer) return;
    dom.previewDotsLayer.innerHTML = "";

    // Simple equirectangular projection onto contiguous US bounds for visual backdrop
    const minLat = 24.5;
    const maxLat = 49.5;
    const minLng = -125.0;
    const maxLng = -66.5;

    for (const station of stations) {
      const x = ((station.lng - minLng) / (maxLng - minLng)) * 100;
      const y = ((maxLat - station.lat) / (maxLat - minLat)) * 100;

      const dot = document.createElement("span");
      dot.className = `preview-dot preview-dot--${station.status}`;
      dot.dataset.stationId = String(station.id);
      dot.style.left = `${Math.max(2, Math.min(98, x))}%`;
      dot.style.top = `${Math.max(4, Math.min(96, y))}%`;
      dot.title = `${station.name} (${station.city}, ${station.state})`;
      dom.previewDotsLayer.appendChild(dot);
    }
  }

  function syncPreviewDotsVisibility(visibleIds) {
    if (!dom.previewDotsLayer) return;
    for (const dot of dom.previewDotsLayer.children) {
      const id = Number(dot.dataset.stationId);
      dot.style.opacity = visibleIds.has(id) ? "1" : "0.14";
    }
  }

  // =========================================================================
  // UI Event Bindings
  // =========================================================================
  function bindUIEvents() {
    dom.filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        dom.filterButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", String(active));
        });
        renderStationList();
      });
    });

    dom.searchInput.addEventListener("input", () => {
      state.search = dom.searchInput.value;
      renderStationList();
    });

    dom.sortSelect.addEventListener("change", () => {
      state.sort = dom.sortSelect.value;
      renderStationList();
    });

    dom.fitBoundsBtn.addEventListener("click", () => {
      fitMapToVisibleStations();
    });

    dom.toggleSidebarBtn.addEventListener("click", () => {
      const collapsed = dom.app.classList.contains("is-sidebar-collapsed");
      setSidebarCollapsed(!collapsed);
    });

    dom.closeSidebarBtn.addEventListener("click", () => {
      setSidebarCollapsed(true);
    });

    dom.apiKeyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = dom.apiKeyInput.value.trim();
      if (!key) return;
      dom.setupError.hidden = true;
      try {
        localStorage.setItem(STORAGE_API_KEY, key);
      } catch {
        // Continue even if storage is unavailable
      }
      dom.setupOverlay.hidden = true;
      bootGoogleMaps(key);
    });

    dom.apiKeyBtn.addEventListener("click", () => {
      dom.modalKeyInput.value = resolveApiKey();
      dom.apiKeyDialog.showModal();
    });

    dom.closeModalBtn.addEventListener("click", () => {
      dom.apiKeyDialog.close();
    });

    dom.apiKeyDialog.addEventListener("click", (e) => {
      if (e.target === dom.apiKeyDialog) {
        dom.apiKeyDialog.close();
      }
    });

    dom.modalKeyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = dom.modalKeyInput.value.trim();
      try {
        if (key) {
          localStorage.setItem(STORAGE_API_KEY, key);
        } else {
          localStorage.removeItem(STORAGE_API_KEY);
        }
      } catch {
        // Ignore
      }
      window.location.reload();
    });

    dom.clearKeyBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(STORAGE_API_KEY);
      } catch {
        // Ignore
      }
      dom.modalKeyInput.value = "";
      window.location.reload();
    });
  }

  function setSidebarCollapsed(collapsed) {
    dom.app.classList.toggle("is-sidebar-collapsed", collapsed);
    dom.toggleSidebarBtn.setAttribute("aria-expanded", String(!collapsed));
  }

  // =========================================================================
  // Google Maps Loader & Map Setup
  // =========================================================================
  function loadGoogleMapsScript(apiKey) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps && window.google.maps.importLibrary) {
        resolve();
        return;
      }

      // Google Maps invokes gm_authFailure if the key is invalid or unauthorized
      window.gm_authFailure = () => {
        showSetupError(
          "Google Maps rejected this API key. Check that the key is valid, billing is active, and HTTP referrer restrictions allow this URL."
        );
      };

      const callbackName = "__historicStationsMapsReady";
      window[callbackName] = () => {
        delete window[callbackName];
        if (window.google && window.google.maps && window.google.maps.importLibrary) {
          resolve();
        } else {
          reject(new Error("Google Maps API callback fired without importLibrary."));
        }
      };

      const existing = document.getElementById("google-maps-sdk");
      if (existing) {
        existing.remove();
      }

      const script = document.createElement("script");
      script.id = "google-maps-sdk";
      script.async = true;
      script.defer = true;
      const params = new URLSearchParams({
        key: apiKey,
        v: "weekly",
        loading: "async",
        callback: callbackName,
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.onerror = () => {
        delete window[callbackName];
        reject(new Error("Failed to load Google Maps JavaScript API script."));
      };
      document.head.appendChild(script);
    });
  }

  function showSetupError(message) {
    const hasBundledKey = Boolean((config.googleMapsApiKey || "").trim());
    if (hasBundledKey) {
      const badge = dom.setupOverlay.querySelector(".setup-badge");
      const title = dom.setupOverlay.querySelector("#setup-title");
      const desc = dom.setupOverlay.querySelector(".setup-desc");
      const help = dom.setupOverlay.querySelector(".setup-help");
      if (badge) badge.textContent = "Map Unavailable";
      if (title) title.textContent = "Google Maps Could Not Load";
      if (desc) desc.textContent = "The interactive map is temporarily unavailable. You can still browse and search all 77 historic train stations in the directory.";
      if (dom.apiKeyForm) dom.apiKeyForm.hidden = true;
      if (help) help.hidden = true;
    }
    dom.setupOverlay.hidden = false;
    dom.setupError.textContent = message;
    dom.setupError.hidden = false;
  }

  async function bootGoogleMaps(apiKey) {
    try {
      await loadGoogleMapsScript(apiKey);

      const [
        { LatLngBounds, ControlPosition },
        { Map, InfoWindow },
        { AdvancedMarkerElement },
        { Place },
      ] = await Promise.all([
        google.maps.importLibrary("core"),
        google.maps.importLibrary("maps"),
        google.maps.importLibrary("marker"),
        google.maps.importLibrary("places"),
      ]);

      LatLngBoundsClass = LatLngBounds;
      PlaceClass = Place;
      AdvancedMarkerClass = AdvancedMarkerElement;

      map = new Map(dom.mapCanvas, {
        center: US_DEFAULT_CENTER,
        zoom: US_DEFAULT_ZOOM,
        mapId: config.mapId || "DEMO_MAP_ID",
        mapTypeControl: true,
        mapTypeControlOptions: {
          position: ControlPosition.TOP_RIGHT,
        },
        streetViewControl: true,
        fullscreenControl: false,
        gestureHandling: "greedy",
      });

      infoWindow = new InfoWindow({
        ariaLabel: "Historic train station Google Place card",
        maxWidth: 340,
        disableAutoPan: true,
      });

      infoWindow.addListener("closeclick", () => {
        cleanupInfoWindowTracking();
        clearSelectedMarker();
      });

      createAllMarkers();
      state.mapReady = true;
      fitMapToVisibleStations();
    } catch (err) {
      console.error("Failed to initialize Google Maps:", err);
      const detail = err && err.message ? ` (${err.message})` : "";
      showSetupError(
        `Unable to initialize Google Maps${detail}. Verify your API key and confirm that Maps JavaScript API and Places API (New) are enabled.`
      );
    }
  }

  // =========================================================================
  // Color-Coded Advanced Markers
  // =========================================================================
  function createPinElement(station) {
    const isActive = station.status === "active";
    const fill = isActive ? "#146C43" : "#B8432E";
    const stroke = isActive ? "#0B462A" : "#7D2819";

    const el = document.createElement("div");
    el.className = `station-pin station-pin--${station.status}`;
    el.dataset.stationId = String(station.id);

    // Active rail icon: classic streamlined train front
    // Defunct/repurposed icon: historic arched terminal facade
    const glyphSvg = isActive
      ? `<g fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
           <rect x="10.2" y="8.2" width="9.6" height="9.2" rx="2.1" />
           <path d="M10.4 13.1h9.2" />
           <circle cx="12.7" cy="15.3" r="0.7" fill="#FFFFFF" stroke="none" />
           <circle cx="17.3" cy="15.3" r="0.7" fill="#FFFFFF" stroke="none" />
           <path d="M12.2 17.5 10.8 20.1M17.8 17.5 19.2 20.1" />
         </g>`
      : `<g fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
           <path d="M9.6 18.8V13a5.4 5.4 0 0 1 10.8 0v5.8" />
           <path d="M8.4 18.8h13.2" />
           <circle cx="15" cy="11.6" r="1.4" fill="#FFFFFF" stroke="none" />
           <path d="M13 18.8v-3.2a2 2 0 0 1 4 0v3.2" />
         </g>`;

    el.innerHTML = `
      <svg viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M15 1.5C7.6 1.5 1.6 7.5 1.6 14.9c0 9.6 11.4 20.1 12.6 21.2a1.2 1.2 0 0 0 1.6 0c1.2-1.1 12.6-11.6 12.6-21.2C28.4 7.5 22.4 1.5 15 1.5Z"
          fill="${fill}"
          stroke="${stroke}"
          stroke-width="1.8"
        />
        ${glyphSvg}
      </svg>
    `;
    return el;
  }

  function createAllMarkers() {
    for (const station of stations) {
      const pinContent = createPinElement(station);
      const statusLabel = station.status === "active" ? "In Rail Use" : "Defunct / Repurposed";

      const marker = new AdvancedMarkerClass({
        map,
        position: { lat: station.lat, lng: station.lng },
        title: `${station.name} (${station.city}, ${station.state}) — ${statusLabel}`,
        content: pinContent,
        zIndex: station.status === "active" ? 2 : 1,
        gmpClickable: true,
      });

      marker.addListener("gmp-click", () => {
        selectStation(station.id, { fromSidebar: false });
      });

      markersById.set(station.id, marker);
    }
  }

  function syncMarkerVisibility(visibleIds) {
    if (!state.mapReady) return;

    for (const [id, marker] of markersById.entries()) {
      const shouldShow = visibleIds.has(id);
      marker.map = shouldShow ? map : null;
    }

    if (state.selectedId && !visibleIds.has(state.selectedId)) {
      cleanupInfoWindowTracking();
      if (infoWindow) infoWindow.close();
      clearSelectedMarker();
    }
  }

  function fitMapToVisibleStations() {
    if (!state.mapReady || !map) return;

    cleanupInfoWindowTracking();
    const visible = getFilteredStations();
    if (visible.length === 0) return;

    if (visible.length === 1) {
      map.panTo({ lat: visible[0].lat, lng: visible[0].lng });
      map.setZoom(13);
      return;
    }

    const bounds = new LatLngBoundsClass();
    for (const station of visible) {
      bounds.extend({ lat: station.lat, lng: station.lng });
    }
    map.fitBounds(bounds, { top: 64, right: 48, bottom: 72, left: 48 });
  }

  function clearSelectedMarker() {
    if (state.selectedId != null) {
      const prevMarker = markersById.get(state.selectedId);
      if (prevMarker && prevMarker.content) {
        prevMarker.content.classList.remove("is-selected");
        const prevStation = stations.find((s) => s.id === state.selectedId);
        prevMarker.zIndex = prevStation && prevStation.status === "active" ? 2 : 1;
      }
    }
    state.selectedId = null;
    highlightSidebarSelection(null);
  }

  function highlightSidebarSelection(stationId, scrollIntoView = false) {
    const cards = dom.stationList.querySelectorAll(".station-card-btn");
    for (const card of cards) {
      const isMatch = Number(card.dataset.stationId) === stationId;
      card.classList.toggle("is-selected", isMatch);
      if (isMatch && scrollIntoView) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  // =========================================================================
  // Station Selection & Google Place Card InfoWindow
  // =========================================================================
  async function selectStation(stationId, { fromSidebar = false } = {}) {
    const station = stations.find((s) => s.id === stationId);
    if (!station) return;

    // Update marker highlight
    clearSelectedMarker();
    state.selectedId = stationId;
    highlightSidebarSelection(stationId, !fromSidebar);

    if (!state.mapReady || !map || !infoWindow) {
      // Preview mode before API key is entered
      if (dom.apiKeyInput && !dom.setupOverlay.hidden) {
        dom.apiKeyInput.focus();
      }
      return;
    }

    const marker = markersById.get(stationId);
    if (!marker) return;

    // Ensure marker is visible on the map
    if (!marker.map) {
      marker.map = map;
    }

    if (marker.content) {
      marker.content.classList.add("is-selected");
    }
    marker.zIndex = 1000;

    // On mobile, collapse sidebar after picking from the list so the Place Card is clearly visible
    if (fromSidebar && window.innerWidth <= 820) {
      setSidebarCollapsed(true);
    }

    // Prevent stale async updates when user clicks rapidly across multiple pins
    const requestToken = ++state.activeRequestToken;
    cleanupInfoWindowTracking();

    // When picking from the sidebar, jump to the station if zoomed out or offscreen;
    // otherwise let ensureInfoWindowInView pan smoothly just enough to frame the card.
    let cameraMoved = false;
    if (fromSidebar) {
      const targetPos = { lat: station.lat, lng: station.lng };
      const needsZoom = map.getZoom() < 11;
      const bounds = map.getBounds();
      const isOffscreen = !bounds || !bounds.contains(targetPos);

      if (needsZoom || isOffscreen) {
        map.setCenter(targetPos);
        if (needsZoom) {
          map.setZoom(12);
        }
        cameraMoved = true;
      }
    }

    // Open InfoWindow immediately with station title header + heritage status + loading skeleton
    const headerEl = buildInfoWindowHeader(station);
    const hasHeaderApi = typeof infoWindow.setHeaderContent === "function";
    if (hasHeaderApi) {
      infoWindow.setHeaderContent(headerEl);
    }
    const container = buildInfoWindowShell(station, hasHeaderApi ? null : headerEl);
    setupInfoWindowAutoPan(container, requestToken, cameraMoved);
    infoWindow.setContent(container);
    infoWindow.open({ anchor: marker, map });

    // Resolve Google Place ID (cached or via Places API Text Search)
    try {
      const placeId = await resolvePlaceId(station);
      if (requestToken !== state.activeRequestToken) return;

      if (!placeId) {
        renderFallbackCard(container, station, "No matching Google Place record was returned for this station.");
        return;
      }

      mountGooglePlaceCard(container, station, placeId, requestToken);
    } catch (err) {
      if (requestToken !== state.activeRequestToken) return;
      console.warn(`Place lookup failed for ${station.name}:`, err);
      const detail = err && err.message ? err.message : String(err || "");
      renderFallbackCard(
        container,
        station,
        "Unable to load the Google Place card. Confirm that Places API (New) and Places UI Kit are enabled for your API key.",
        detail
      );
    }
  }

  function buildInfoWindowHeader(station) {
    const title = document.createElement("h3");
    title.className = "iw-header-title";
    title.textContent = station.name;
    // Inline styles ensure visibility even inside Google Maps' InfoWindow shadow/slot rules
    title.style.margin = "0";
    title.style.padding = "2px 8px 0 0";
    title.style.fontFamily = '"Fraunces", Georgia, "Times New Roman", serif';
    title.style.fontSize = "1rem";
    title.style.fontWeight = "600";
    title.style.lineHeight = "1.25";
    title.style.color = "#1c1a17";
    return title;
  }

  function buildInfoWindowShell(station, inlineHeaderEl = null) {
    const isActive = station.status === "active";
    const statusText = isActive ? "In Rail Use" : "Defunct / Repurposed";

    const wrapper = document.createElement("div");
    wrapper.className = "iw-wrapper";
    wrapper.style.colorScheme = "light";
    wrapper.style.color = "#1c1a17";

    if (inlineHeaderEl) {
      inlineHeaderEl.style.marginBottom = "6px";
      wrapper.appendChild(inlineHeaderEl);
    }

    const statusBar = document.createElement("div");
    statusBar.className = "iw-status-bar";

    const pill = document.createElement("span");
    pill.className = `iw-status-pill iw-status-pill--${station.status}`;
    pill.innerHTML = `<span class="status-dot status-dot--${station.status}"></span>${statusText}`;

    const meta = document.createElement("span");
    meta.className = "iw-meta-tag";
    meta.textContent = station.opened ? `#${station.id} · Est. ${station.opened}` : `#${station.id}`;

    statusBar.appendChild(pill);
    statusBar.appendChild(meta);

    const body = document.createElement("div");
    body.className = "iw-body is-loading";
    body.innerHTML = `
      <div class="iw-loading" aria-live="polite" aria-label="Loading Google Place card">
        <div class="iw-skeleton-img"></div>
        <div class="iw-skeleton-line"></div>
        <div class="iw-skeleton-line"></div>
        <div class="iw-skeleton-line iw-skeleton-line--short"></div>
      </div>
    `;

    wrapper.appendChild(statusBar);
    wrapper.appendChild(body);
    return wrapper;
  }

  function cleanupInfoWindowTracking() {
    if (iwResizeObserver) {
      iwResizeObserver.disconnect();
      iwResizeObserver = null;
    }
    if (iwDomReadyListener) {
      google.maps.event.removeListener(iwDomReadyListener);
      iwDomReadyListener = null;
    }
    if (iwMapDragListener) {
      google.maps.event.removeListener(iwMapDragListener);
      iwMapDragListener = null;
    }
    if (iwMapWheelHandler && dom.mapCanvas) {
      dom.mapCanvas.removeEventListener("wheel", iwMapWheelHandler);
      iwMapWheelHandler = null;
    }
    if (iwIdleListener) {
      google.maps.event.removeListener(iwIdleListener);
      iwIdleListener = null;
    }
    if (iwInitialIdleListener) {
      google.maps.event.removeListener(iwInitialIdleListener);
      iwInitialIdleListener = null;
    }
    if (iwRafId !== null) {
      window.cancelAnimationFrame(iwRafId);
      iwRafId = null;
    }
    if (iwFallbackTimer !== null) {
      window.clearTimeout(iwFallbackTimer);
      iwFallbackTimer = null;
    }
    iwPanning = false;
    iwPendingReposition = false;
    iwUserInteracted = false;
    iwPanCount = 0;
  }

  function setupInfoWindowAutoPan(container, requestToken, waitForInitialIdle = false) {
    if (!map || !infoWindow) return;

    const onUserMapInteraction = () => {
      iwUserInteracted = true;
      iwPendingReposition = false;
      if (iwResizeObserver) {
        iwResizeObserver.disconnect();
        iwResizeObserver = null;
      }
      if (iwRafId !== null) {
        window.cancelAnimationFrame(iwRafId);
        iwRafId = null;
      }
    };

    iwMapDragListener = map.addListener("dragstart", onUserMapInteraction);
    if (dom.mapCanvas) {
      iwMapWheelHandler = (event) => {
        // Ignore wheel scrolling inside the InfoWindow card itself
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".gm-style-iw-c")) {
          return;
        }
        onUserMapInteraction();
      };
      dom.mapCanvas.addEventListener("wheel", iwMapWheelHandler, { passive: true });
    }

    const attachResizeObserver = () => {
      if (iwUserInteracted || requestToken !== state.activeRequestToken) return;
      if (typeof ResizeObserver === "undefined") return;

      if (iwResizeObserver) {
        iwResizeObserver.disconnect();
      }

      iwResizeObserver = new ResizeObserver(() => {
        scheduleEnsureInfoWindowInView(container, requestToken);
      });

      const iwEl = container.closest(".gm-style-iw-c");
      if (iwEl) {
        iwResizeObserver.observe(iwEl);
      }
      iwResizeObserver.observe(container);

      const placeDetails = container.querySelector("gmp-place-details-compact");
      if (placeDetails) {
        iwResizeObserver.observe(placeDetails);
      }
    };

    iwDomReadyListener = google.maps.event.addListenerOnce(infoWindow, "domready", () => {
      iwDomReadyListener = null;
      if (requestToken !== state.activeRequestToken) return;
      attachResizeObserver();
      scheduleEnsureInfoWindowInView(container, requestToken);
    });

    if (waitForInitialIdle) {
      iwInitialIdleListener = google.maps.event.addListenerOnce(map, "idle", () => {
        iwInitialIdleListener = null;
        if (requestToken !== state.activeRequestToken) return;
        if (!iwResizeObserver) {
          attachResizeObserver();
        }
        scheduleEnsureInfoWindowInView(container, requestToken);
      });
    }
  }

  function scheduleEnsureInfoWindowInView(container, requestToken) {
    if (iwUserInteracted || requestToken !== state.activeRequestToken) return;
    if (iwPanning) {
      iwPendingReposition = true;
      return;
    }
    if (iwRafId !== null) {
      window.cancelAnimationFrame(iwRafId);
    }
    iwRafId = window.requestAnimationFrame(() => {
      iwRafId = null;
      ensureInfoWindowInView(container, requestToken);
    });
  }

  function ensureInfoWindowInView(container, requestToken) {
    if (iwUserInteracted || requestToken !== state.activeRequestToken) return;
    if (!map || !dom.mapCanvas || !container || !container.isConnected) return;
    if (iwPanCount >= 8) return;

    const iwCard = container.closest(".gm-style-iw-c");
    const iwEl = iwCard || container;
    const mapRect = dom.mapCanvas.getBoundingClientRect();
    const iwRect = iwEl.getBoundingClientRect();

    if (mapRect.width <= 0 || mapRect.height <= 0 || iwRect.width <= 0 || iwRect.height <= 0) {
      return;
    }

    // Reserve breathing room for top floating buttons, map controls, and marker pin below the card
    const headerFallbackExtra = iwCard ? 0 : 48;
    const preferredTopPad = 64 + headerFallbackExtra;
    const minTopPad = 16 + headerFallbackExtra;
    const preferredBottomPad = 72;
    const minBottomPad = 24;

    const availableVerticalSlack = mapRect.height - iwRect.height;
    let topPad;
    let bottomPad;
    if (availableVerticalSlack >= preferredTopPad + preferredBottomPad) {
      topPad = preferredTopPad;
      bottomPad = preferredBottomPad;
    } else if (availableVerticalSlack >= minTopPad + minBottomPad) {
      topPad = Math.max(minTopPad, Math.min(preferredTopPad, Math.floor(availableVerticalSlack * 0.48)));
      bottomPad = Math.max(minBottomPad, availableVerticalSlack - topPad);
    } else {
      topPad = 12 + headerFallbackExtra;
      bottomPad = 12;
    }

    const sidePad = mapRect.width < 480 ? 12 : 20;
    const safeTop = mapRect.top + topPad;
    const safeBottom = mapRect.bottom - bottomPad;
    const safeLeft = mapRect.left + sidePad;
    const safeRight = mapRect.right - sidePad;

    let dy = 0;
    if (iwRect.top < safeTop) {
      dy = iwRect.top - safeTop;
    } else if (iwRect.bottom > safeBottom) {
      const maxUpShift = Math.max(0, iwRect.top - safeTop);
      dy = Math.min(iwRect.bottom - safeBottom, maxUpShift);
    }

    let dx = 0;
    if (iwRect.left < safeLeft && iwRect.right > safeRight) {
      const iwCenterX = (iwRect.left + iwRect.right) / 2;
      const mapCenterX = (mapRect.left + mapRect.right) / 2;
      dx = iwCenterX - mapCenterX;
    } else if (iwRect.left < safeLeft) {
      dx = iwRect.left - safeLeft;
    } else if (iwRect.right > safeRight) {
      const maxLeftShift = Math.max(0, iwRect.left - safeLeft);
      dx = Math.min(iwRect.right - safeRight, maxLeftShift);
    }

    dx = Math.abs(dx) >= 2 ? Math.round(dx) : 0;
    dy = Math.abs(dy) >= 2 ? Math.round(dy) : 0;

    if (dx !== 0 || dy !== 0) {
      panMapToFitInfoWindow(container, dx, dy, requestToken);
    }
  }

  function panMapToFitInfoWindow(container, dx, dy, requestToken) {
    iwPanning = true;
    iwPendingReposition = false;
    iwPanCount += 1;

    if (iwIdleListener) {
      google.maps.event.removeListener(iwIdleListener);
      iwIdleListener = null;
    }
    if (iwFallbackTimer !== null) {
      window.clearTimeout(iwFallbackTimer);
      iwFallbackTimer = null;
    }

    const onPanSettled = () => {
      if (iwIdleListener) {
        google.maps.event.removeListener(iwIdleListener);
        iwIdleListener = null;
      }
      if (iwFallbackTimer !== null) {
        window.clearTimeout(iwFallbackTimer);
        iwFallbackTimer = null;
      }
      iwPanning = false;
      if (iwPendingReposition && !iwUserInteracted && requestToken === state.activeRequestToken) {
        iwPendingReposition = false;
        scheduleEnsureInfoWindowInView(container, requestToken);
      }
    };

    iwIdleListener = google.maps.event.addListenerOnce(map, "idle", onPanSettled);
    iwFallbackTimer = window.setTimeout(onPanSettled, 500);
    map.panBy(dx, dy);
  }

  async function resolvePlaceId(station) {
    if (station.placeId) return station.placeId;
    if (placeIdCache[station.id]) return placeIdCache[station.id];
    if (!PlaceClass || typeof PlaceClass.searchByText !== "function") {
      throw new Error("Places API (New) Place.searchByText is unavailable.");
    }

    const queries = [
      {
        textQuery: station.placeQuery || `${station.name}, ${station.city}, ${station.state}`,
        radius: 1500,
      },
      {
        textQuery: `${station.name} ${station.city} ${station.state}`,
        radius: 5000,
      },
    ];

    for (const attempt of queries) {
      const request = {
        textQuery: attempt.textQuery,
        fields: ["id"],
        locationBias: {
          center: { lat: station.lat, lng: station.lng },
          radius: attempt.radius,
        },
        maxResultCount: 1,
      };

      const { places } = await PlaceClass.searchByText(request);
      if (places && places.length > 0 && places[0].id) {
        savePlaceIdToCache(station.id, places[0].id);
        return places[0].id;
      }
    }

    return null;
  }

  function mountGooglePlaceCard(container, station, placeId, requestToken) {
    const body = container.querySelector(".iw-body");
    if (!body) return;

    const placeDetails = document.createElement("gmp-place-details-compact");
    placeDetails.setAttribute("orientation", "vertical");
    placeDetails.setAttribute("truncation-preferred", "");

    // Inline styles + explicit light-theme CSS variables prevent OS Dark Mode from
    // rendering light/white Place Card text against Google Maps' white InfoWindow.
    placeDetails.style.width = "300px";
    placeDetails.style.maxWidth = "100%";
    placeDetails.style.display = "block";
    placeDetails.style.border = "none";
    placeDetails.style.boxShadow = "none";
    placeDetails.style.colorScheme = "light";
    placeDetails.style.background = "#ffffff";
    placeDetails.style.color = "#1c1a17";
    placeDetails.style.setProperty("--gmp-mat-color-surface", "#ffffff");
    placeDetails.style.setProperty("--gmp-mat-color-on-surface", "#1c1a17");
    placeDetails.style.setProperty("--gmp-mat-color-on-surface-variant", "#4a4640");
    placeDetails.style.setProperty("--gmp-mat-color-primary", "#146c43");
    placeDetails.style.setProperty("--gmp-mat-color-outline-decorative", "#e2d9cb");
    placeDetails.style.setProperty("--gmp-mat-color-positive", "#146c43");
    placeDetails.style.setProperty("--gmp-mat-color-negative", "#b8432e");
    placeDetails.style.setProperty("--gmp-color-surface", "#ffffff");
    placeDetails.style.setProperty("--gmp-color-on-surface", "#1c1a17");
    placeDetails.style.setProperty("--gmp-color-on-surface-variant", "#4a4640");
    placeDetails.style.setProperty("--gmp-color-primary", "#146c43");

    const placeRequest = document.createElement("gmp-place-details-place-request");
    placeRequest.setAttribute("place", placeId);
    placeRequest.place = placeId;

    const allContent = document.createElement("gmp-place-all-content");

    placeDetails.appendChild(placeRequest);
    placeDetails.appendChild(allContent);

    let settled = false;
    const hideSkeleton = () => {
      body.classList.remove("is-loading");
      const loader = body.querySelector(".iw-loading");
      if (loader) loader.remove();
    };

    const handleLoaded = () => {
      if (settled || requestToken !== state.activeRequestToken) return;
      settled = true;
      hideSkeleton();
      placeDetails.style.opacity = "1";
      scheduleEnsureInfoWindowInView(container, requestToken);
    };

    const handleError = (event) => {
      if (settled || requestToken !== state.activeRequestToken) return;
      settled = true;
      console.warn(`Places UI Kit error for ${station.name}:`, event);
      const detail = event && event.error && event.error.message ? event.error.message : "";
      renderFallbackCard(
        container,
        station,
        "The Google Place card could not be rendered. Ensure Places API (New) and Places UI Kit are enabled on your API key.",
        detail
      );
    };

    placeDetails.addEventListener("gmp-load", handleLoaded);
    placeDetails.addEventListener("gmp-requesterror", handleError);
    placeDetails.addEventListener("gmp-error", handleError);

    // Keep element mounted (slightly hidden until gmp-load) so the custom element triggers its request
    placeDetails.style.opacity = "0";
    placeDetails.style.transition = "opacity 160ms ease";
    body.appendChild(placeDetails);
    if (iwResizeObserver) {
      iwResizeObserver.observe(placeDetails);
    }

    // Safety fallback if the custom element takes too long or doesn't emit gmp-load
    window.setTimeout(() => {
      if (settled || requestToken !== state.activeRequestToken) return;
      hideSkeleton();
      placeDetails.style.opacity = "1";
      scheduleEnsureInfoWindowInView(container, requestToken);
    }, 3500);
  }

  function renderFallbackCard(container, station, note, technicalDetail = "") {
    const body = container.querySelector(".iw-body");
    if (!body) return;
    body.classList.remove("is-loading");

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      station.placeQuery || `${station.name}, ${station.city}, ${station.state}`
    )}`;

    const detailHtml = technicalDetail
      ? `<p class="iw-fallback-note" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.7rem; word-break: break-word;">${escapeHtml(
          technicalDetail
        )}</p>`
      : "";

    body.innerHTML = `
      <div class="iw-fallback">
        <h3>${escapeHtml(station.name)}</h3>
        <p class="iw-fallback-loc">${escapeHtml(station.city)}, ${escapeHtml(station.state)}${
          station.opened ? ` · Opened ${escapeHtml(String(station.opened))}` : ""
        }</p>
        <p class="iw-fallback-note">${escapeHtml(note)}</p>
        ${detailHtml}
        <a class="iw-maps-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
          View on Google Maps ↗
        </a>
      </div>
    `;
    scheduleEnsureInfoWindowInView(container, state.activeRequestToken);
  }

  function escapeHtml(str) {
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
