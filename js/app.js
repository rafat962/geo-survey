/* =========================================================================
 * FIELD DATA COLLECTION & ROUTE NAVIGATION APP
 * ========================================================================= */

(function () {
  const IS_LOCAL_FILE = location.protocol === "file:";
  const LOCAL_AUTH_KEY = "fieldAppLocalAuth";
  const LOGIN_REDIRECT_URL = /\/exec(?:\/|$)/i.test(location.pathname)
    ? "/?next=/exec/"
    : "/";

  if (IS_LOCAL_FILE) {
    try {
      if (!sessionStorage.getItem(LOCAL_AUTH_KEY)) {
        window.location.replace("../index.html");
        return;
      }
    } catch (err) {
      window.location.replace("../index.html");
      return;
    }
  }

  async function initSessionControls() {
    const userBadge = document.getElementById("userBadge");
    const btnLogout = document.getElementById("btnLogout");

    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        if (IS_LOCAL_FILE) {
          try {
            sessionStorage.removeItem(LOCAL_AUTH_KEY);
          } catch (err) {}
          window.location.replace("../index.html");
          return;
        }
        try {
          await fetch("/api/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            }
          });
        } catch (err) {
          console.warn("Logout request failed:", err);
        }
        window.location.replace(LOGIN_REDIRECT_URL);
      });
    }

    if (IS_LOCAL_FILE) {
      try {
        const localUser = sessionStorage.getItem(LOCAL_AUTH_KEY);
        if (localUser && userBadge) {
          userBadge.textContent = localUser;
          userBadge.hidden = false;
        }
      } catch (err) {}
      return;
    }

    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.status === 401 || res.status === 404) {
        window.location.replace(LOGIN_REDIRECT_URL);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated && data.user && userBadge) {
          userBadge.textContent = data.user;
          userBadge.hidden = false;
        } else if (!data?.authenticated) {
          window.location.replace(LOGIN_REDIRECT_URL);
        }
      }
    } catch (err) {
      // Allow offline field usage after initial page load if network drops temporarily
      console.warn("Session endpoint unreachable:", err);
    }
  }

  initSessionControls();

  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/layers/GraphicsLayer",
    "esri/Graphic",
    "esri/geometry/Point",
    "esri/geometry/Polyline",
    "esri/widgets/Track",
    "esri/widgets/Fullscreen",
    "esri/renderers/UniqueValueRenderer",
    "esri/renderers/SimpleRenderer",
    "esri/symbols/SimpleMarkerSymbol",
    "esri/symbols/SimpleLineSymbol",
    "esri/layers/support/LabelClass",
    "esri/identity/IdentityManager",
    "esri/core/reactiveUtils"
  ], function (
    Map,
    MapView,
    FeatureLayer,
    GraphicsLayer,
    Graphic,
    Point,
    Polyline,
    Track,
    Fullscreen,
    UniqueValueRenderer,
    SimpleRenderer,
    SimpleMarkerSymbol,
    SimpleLineSymbol,
    LabelClass,
    IdentityManager,
    reactiveUtils
  ) {
    // --- DOM References ---
    const els = {
      progressText: document.getElementById("progressText"),
      progressPercent: document.getElementById("progressPercent"),
      progressFill: document.getElementById("progressFill"),
      btnFullscreen: document.getElementById("btnFullscreen"),
      fullscreenIcon: document.getElementById("fullscreenIcon"),
      btnMyLocation: document.getElementById("btnMyLocation"),
      btnZoomAll: document.getElementById("btnZoomAll"),
      demoBadge: document.getElementById("demoBadge"),
      setupModal: document.getElementById("setupModal"),
      btnStartDemo: document.getElementById("btnStartDemo"),
      toast: document.getElementById("toast"),
      sheetBackdrop: document.getElementById("sheetBackdrop"),
      bottomSheet: document.getElementById("bottomSheet"),
      sheetTitle: document.getElementById("sheetTitle"),
      sheetStatusBadge: document.getElementById("sheetStatusBadge"),
      btnSheetGoogleMaps: document.getElementById("btnSheetGoogleMaps"),
      btnCloseSheet: document.getElementById("btnCloseSheet"),
      pointForm: document.getElementById("pointForm"),
      fieldCommitteeDecision: document.getElementById("fieldCommitteeDecision"),
      fieldHasBase: document.getElementById("fieldHasBase"),
      fieldNotesObstacles: document.getElementById("fieldNotesObstacles"),
      notesRequiredBadge: document.getElementById("notesRequiredBadge"),
      fieldExecStage: document.getElementById("fieldExecStage"),
      fieldExecNotes: document.getElementById("fieldExecNotes"),
      existingPhotosSection: document.getElementById("existingPhotosSection"),
      existingPhotosCountLabel: document.getElementById("existingPhotosCountLabel"),
      existingPhotosList: document.getElementById("existingPhotosList"),
      existingPhotosUndoBar: document.getElementById("existingPhotosUndoBar"),
      existingPhotosDeleteNotice: document.getElementById("existingPhotosDeleteNotice"),
      btnUndoDeletePhotos: document.getElementById("btnUndoDeletePhotos"),
      photoInput: document.getElementById("photoInput"),
      btnPickPhoto: document.getElementById("btnPickPhoto"),
      photoCountLabel: document.getElementById("photoCountLabel"),
      photoGallery: document.getElementById("photoGallery"),
      formError: document.getElementById("formError"),
      btnSubmitForm: document.getElementById("btnSubmitForm"),
      submitSpinner: document.getElementById("submitSpinner"),
      submitBtnText: document.getElementById("submitBtnText"),
      photoViewerModal: document.getElementById("photoViewerModal"),
      photoViewerImg: document.getElementById("photoViewerImg"),
      photoViewerCaption: document.getElementById("photoViewerCaption"),
      btnClosePhotoViewer: document.getElementById("btnClosePhotoViewer"),
      offlineBanner: document.getElementById("offlineBanner"),
      outboxPillBtn: document.getElementById("outboxPillBtn"),
      outboxCountText: document.getElementById("outboxCountText"),
      outboxActionHint: document.getElementById("outboxActionHint"),
      outboxBackdrop: document.getElementById("outboxBackdrop"),
      outboxSheet: document.getElementById("outboxSheet"),
      outboxNetBadge: document.getElementById("outboxNetBadge"),
      btnCloseOutbox: document.getElementById("btnCloseOutbox"),
      btnSyncAll: document.getElementById("btnSyncAll"),
      syncAllSpinner: document.getElementById("syncAllSpinner"),
      syncAllBtnText: document.getElementById("syncAllBtnText"),
      outboxSyncStatus: document.getElementById("outboxSyncStatus"),
      outboxList: document.getElementById("outboxList")
    };

    // --- Mode Configuration (Handover /app/ vs Execution /exec/) ---
    const APP_MODE =
      window.APP_MODE ||
      document.body?.dataset?.appMode ||
      (/\/exec(?:\/|$)/i.test(location.pathname) ? "exec" : "handover");
    const IS_EXEC_MODE = APP_MODE === "exec";

    const ACTIVE_POINTS_URL = IS_EXEC_MODE
      ? (typeof EXEC_CONFIG !== "undefined" && EXEC_CONFIG.pointsLayerUrl) || ""
      : POINTS_LAYER_URL;
    const ACTIVE_ROUTE_URL = IS_EXEC_MODE
      ? (typeof EXEC_CONFIG !== "undefined" && EXEC_CONFIG.routeLayerUrl) || ""
      : ROUTE_LAYER_URL;
    const ACTIVE_FIELDS = IS_EXEC_MODE
      ? {
          ...FIELDS,
          ...((typeof EXEC_CONFIG !== "undefined" && EXEC_CONFIG.fields) || {})
        }
      : FIELDS;
    const POINTS_CACHE_KEY = IS_EXEC_MODE ? "exec_points_cache" : "handover_points_cache";
    const ROUTE_CACHE_KEY = IS_EXEC_MODE ? "exec_route_cache" : "handover_route_cache";

    // Sync Execution stage options dynamically from EXEC_CONFIG.stages
    if (
      IS_EXEC_MODE &&
      els.fieldExecStage &&
      typeof EXEC_CONFIG !== "undefined" &&
      Array.isArray(EXEC_CONFIG.stages) &&
      EXEC_CONFIG.stages.length > 0
    ) {
      els.fieldExecStage.innerHTML =
        '<option value="" disabled selected>-- اختر المرحلة --</option>';
      EXEC_CONFIG.stages.forEach((stageName) => {
        const opt = document.createElement("option");
        opt.value = stageName;
        opt.textContent = stageName;
        els.fieldExecStage.appendChild(opt);
      });
    }

    // --- State ---
    let pointsLayer = null;
    let routeLayer = null;
    let activeOrderField = ACTIVE_FIELDS.order || "Sequence";
    let activeStatusField = ACTIVE_FIELDS.status || "status";
    let activeNameField = ACTIVE_FIELDS.name || "Name";
    let resolvedPointsServiceUrl = ACTIVE_POINTS_URL;
    let resolvedRouteServiceUrl = ACTIVE_ROUTE_URL;
    let cachedFeatures = [];
    let activeFeature = null;
    let selectedPhotos = [];
    let existingAttachments = [];
    let pendingDeleteAttachmentIds = [];
    let openedWithOutboxDraft = false;
    let photoIdCounter = 0;
    let isDemoMode = false;
    let isOfflineCacheMode = false;
    let cachedOutboxItems = [];
    let isSyncingOutbox = false;
    let initialZoomDone = false;
    let toastTimer = null;

    // --- Map & View ---
    const map = new Map({
      basemap: MAP_CONFIG.basemap
    });

    const view = new MapView({
      container: "viewDiv",
      map: map,
      center: MAP_CONFIG.defaultCenter,
      zoom: MAP_CONFIG.defaultZoom,
      ui: {
        components: ["attribution"]
      },
      popup: {
        autoOpenEnabled: false
      },
      padding: {
        top: 74,
        bottom: 36,
        left: 8,
        right: 8
      }
    });

    // --- Live GPS Track (background) & Fullscreen ViewModel ---
    const fullscreen = new Fullscreen({
      view: view,
      element: document.documentElement
    });

    const track = new Track({
      view: view,
      goToLocationEnabled: false,
      useHeadingEnabled: true
    });

    if (els.btnFullscreen) {
      els.btnFullscreen.addEventListener("click", () => {
        try {
          fullscreen.viewModel.toggle();
        } catch (err) {
          console.warn("Fullscreen toggle warning:", err);
        }
      });

      reactiveUtils.watch(
        () => fullscreen.viewModel.state,
        (state) => {
          const isActive = state === "active";
          els.btnFullscreen.title = isActive ? "إنهاء ملء الشاشة" : "ملء الشاشة";
          if (els.fullscreenIcon) {
            els.fullscreenIcon.innerHTML = isActive
              ? '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>'
              : '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
          }
        }
      );
    }

    view.when(() => {
      try {
        track.start();
      } catch (err) {
        console.warn("Track auto-start warning:", err);
      }
    });

    track.on("track-error", (evt) => {
      console.warn("GPS track error:", evt?.error);
    });

    // --- Symbology & Labeling ---
    function getRouteLineSymbol() {
      return new SimpleLineSymbol({
        color: [56, 189, 248, 0.92],
        width: 4,
        style: "solid",
        cap: "round",
        join: "round"
      });
    }

    function createPointsRenderer(statusFieldName = activeStatusField) {
      const pendingSymbol = new SimpleMarkerSymbol({
        style: "circle",
        color: "#ea580c",
        size: "24px",
        outline: {
          color: "#ffffff",
          width: 2.5
        }
      });

      if (!statusFieldName) {
        return new SimpleRenderer({
          symbol: pendingSymbol,
          label: "نقاط المسار"
        });
      }

      // Dim completed stops so they don't visually clash with nearby upcoming stops
      const completedSymbol = new SimpleMarkerSymbol({
        style: "circle",
        color: [22, 163, 74, 0.65],
        size: "14px",
        outline: {
          color: [255, 255, 255, 0.75],
          width: 1.5
        }
      });

      return new UniqueValueRenderer({
        field: statusFieldName,
        defaultSymbol: pendingSymbol,
        defaultLabel: "قيد الانتظار",
        uniqueValueInfos: [
          {
            value: STATUS_VALUES.pending,
            symbol: pendingSymbol,
            label: "قيد الانتظار"
          },
          {
            value: STATUS_VALUES.completed,
            symbol: completedSymbol,
            label: "مكتملة"
          }
        ]
      });
    }

    function resolveNameFieldName(fields) {
      if (!Array.isArray(fields) || fields.length === 0) return null;
      const target = (ACTIVE_FIELDS.name || "Name").toLowerCase();
      const match = fields.find((f) => f.name?.toLowerCase() === target);
      return match ? match.name : null;
    }

    function createNumberedLabeling(
      orderFieldName = activeOrderField,
      statusFieldName = activeStatusField,
      nameFieldName = activeNameField
    ) {
      if (nameFieldName) {
        const escapedField = nameFieldName.replace(/"/g, '\\"');
        const cleanCodeArcade = [
          `var raw = Trim(DefaultValue($feature["${escapedField}"], ''));`,
          `var dotIdx = Find('.', raw);`,
          `var sepIdx = IIf(dotIdx > 0 && dotIdx <= 4 && IsNan(Number(Left(raw, dotIdx))) == false, dotIdx, Find(' ', raw));`,
          `IIf(sepIdx > 0 && sepIdx <= 4 && IsNan(Number(Left(raw, sepIdx))) == false, Trim(Mid(raw, sepIdx + 1)), raw)`
        ].join("\n");

        return [
          new LabelClass({
            labelPlacement: "above-center",
            labelExpressionInfo: {
              expression: cleanCodeArcade
            },
            symbol: {
              type: "text",
              color: "#ffffff",
              haloColor: "rgba(15, 23, 42, 0.92)",
              haloSize: "2px",
              yoffset: 3,
              font: {
                family: "Arial, sans-serif",
                size: "11px",
                weight: "bold"
              }
            }
          })
        ];
      }

      if (!orderFieldName) return [];

      const labelClassConfig = {
        labelPlacement: "center-center",
        labelExpressionInfo: {
          expression: `$feature.${orderFieldName}`
        },
        symbol: {
          type: "text",
          color: "#ffffff",
          haloColor: "rgba(15, 23, 42, 0.65)",
          haloSize: "1.3px",
          font: {
            family: "Arial, sans-serif",
            size: "12px",
            weight: "bold"
          }
        }
      };

      if (statusFieldName) {
        labelClassConfig.where = `${statusFieldName} <> '${STATUS_VALUES.completed}' OR ${statusFieldName} IS NULL`;
      }

      return [new LabelClass(labelClassConfig)];
    }

    // --- Private Layer Token Registration (/api/esri-token) ---
    let esriTokenRefreshTimer = null;

    function getServiceServers(layerUrl) {
      if (!layerUrl || typeof layerUrl !== "string") return [];
      const trimmed = layerUrl.trim();
      if (!trimmed) return [];
      const servers = [];
      const restMatch = trimmed.match(/^(https?:\/\/[^?#]+?\/rest\/services)/i);
      if (restMatch) servers.push(restMatch[1]);
      try {
        servers.push(new URL(trimmed).origin);
      } catch (err) {}
      return servers;
    }

    async function registerEsriTokenFromServer() {
      if (IS_LOCAL_FILE) {
        return { token: null, error: "تشغيل محلي بدون خادم التوثيق" };
      }

      try {
        const res = await fetch("/api/esri-token", { cache: "no-store" });
        if (res.status === 401) {
          window.location.replace(LOGIN_REDIRECT_URL);
          return { token: null, error: "انتهت الجلسة، يرجى إعادة تسجيل الدخول" };
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data.error || `HTTP ${res.status}`;
          console.warn("Esri token endpoint error:", errMsg);
          return { token: null, error: errMsg };
        }

        const accessToken = data.access_token || data.token;
        if (!accessToken) {
          return { token: null, error: "الخادم لم يُرجع رمز دخول صالح (access_token)" };
        }

        const expiresInSec = Number(data.expires_in) || 3600;
        const expiresAtMs = Date.now() + expiresInSec * 1000;
        const portalBase = (data.portalUrl || "https://www.arcgis.com").replace(/\/+$/, "");

        const serverRoots = new Set([
          `${portalBase}/sharing/rest`,
          ...getServiceServers(ACTIVE_POINTS_URL),
          ...getServiceServers(ACTIVE_ROUTE_URL)
        ]);

        serverRoots.forEach((server) => {
          IdentityManager.registerToken({
            server,
            token: accessToken,
            expires: expiresAtMs,
            ssl: server.startsWith("https://")
          });
        });

        // Silently renew 5 minutes before expiration
        if (esriTokenRefreshTimer) clearTimeout(esriTokenRefreshTimer);
        const refreshDelayMs = Math.max(60000, (expiresInSec - 300) * 1000);
        esriTokenRefreshTimer = setTimeout(() => {
          registerEsriTokenFromServer().catch(() => {});
        }, refreshDelayMs);

        return { token: accessToken, error: null };
      } catch (err) {
        console.warn("Failed to fetch /api/esri-token:", err);
        return { token: null, error: err?.message || "تعذر الاتصال بـ /api/esri-token" };
      }
    }

    // --- Layer Initialization ---
    function resolveOrderFieldName(fields) {
      if (!Array.isArray(fields) || fields.length === 0) {
        return ACTIVE_FIELDS.order || "Sequence";
      }
      const candidates = [
        ACTIVE_FIELDS.order || "Sequence",
        ACTIVE_FIELDS.orderFallback || "order_num",
        "Sequence",
        "order_num",
        "StopOrder",
        "OrderNum",
        "Order_Num",
        "Seq",
        "Stop_Num",
        "Point_Num",
        "Order"
      ];

      for (const candidate of candidates) {
        const match = fields.find(
          (f) => f.name?.toLowerCase() === candidate.toLowerCase()
        );
        if (match) return match.name;
      }

      const oidField = fields.find((f) => f.type === "oid");
      return oidField ? oidField.name : ACTIVE_FIELDS.order || "Sequence";
    }

    function resolveStatusFieldName(fields) {
      if (!Array.isArray(fields) || fields.length === 0) return null;
      const target = (ACTIVE_FIELDS.status || "status").toLowerCase();
      const match = fields.find((f) => f.name?.toLowerCase() === target);
      return match ? match.name : null;
    }

    function getStopStatusValue(attrs) {
      if (!attrs) return null;
      const candidates = [activeStatusField, ACTIVE_FIELDS.status, "status"].filter(Boolean);
      for (const name of candidates) {
        if (attrs[name] !== undefined) return attrs[name];
        const ciKey = Object.keys(attrs).find(
          (k) => k.toLowerCase() === name.toLowerCase()
        );
        if (ciKey) return attrs[ciKey];
      }
      return null;
    }

    function getStopOrderValue(attrs) {
      if (!attrs) return null;
      const candidates = [
        activeOrderField,
        ACTIVE_FIELDS.order,
        ACTIVE_FIELDS.orderFallback,
        "Sequence",
        "order_num",
        "OBJECTID"
      ].filter(Boolean);

      for (const name of candidates) {
        if (attrs[name] !== undefined && attrs[name] !== null && attrs[name] !== "") {
          return attrs[name];
        }
        const ciKey = Object.keys(attrs).find(
          (k) => k.toLowerCase() === name.toLowerCase()
        );
        if (ciKey && attrs[ciKey] !== undefined && attrs[ciKey] !== null && attrs[ciKey] !== "") {
          return attrs[ciKey];
        }
      }
      return null;
    }

    async function fetchSublayerDetails(serviceRoot, layerStub, token, includeCount = false) {
      const layerUrl = `${serviceRoot}/${layerStub.id}`;
      let geometryType = layerStub.geometryType || null;
      let name = layerStub.name || "";
      let count = null;

      try {
        if (!geometryType) {
          const detailUrl = new URL(layerUrl);
          detailUrl.searchParams.set("f", "json");
          if (token) detailUrl.searchParams.set("token", token);
          const detailRes = await fetch(detailUrl.toString());
          if (detailRes.ok) {
            const detailJson = await detailRes.json().catch(() => null);
            geometryType = detailJson?.geometryType || geometryType;
            name = detailJson?.name || name;
          }
        }

        if (includeCount) {
          const countUrl = new URL(`${layerUrl}/query`);
          countUrl.searchParams.set("where", "1=1");
          countUrl.searchParams.set("returnCountOnly", "true");
          countUrl.searchParams.set("f", "json");
          if (token) countUrl.searchParams.set("token", token);
          const countRes = await fetch(countUrl.toString());
          if (countRes.ok) {
            const countJson = await countRes.json().catch(() => null);
            if (typeof countJson?.count === "number") {
              count = countJson.count;
            }
          }
        }
      } catch (err) {
        console.warn("Sublayer detail inspection failed for", layerUrl, err);
      }

      return { id: layerStub.id, name, geometryType, count, url: layerUrl };
    }

    async function resolveFeatureLayerUrl(configuredUrl, token, preferredGeomType) {
      const cleanUrl = (configuredUrl || "").trim().replace(/\/+$/, "");
      if (!cleanUrl) return cleanUrl;

      const match = cleanUrl.match(/^(.*\/(?:FeatureServer|MapServer))(?:\/(\d+))?$/i);
      if (!match) return cleanUrl;

      const serviceRoot = match[1];
      const configuredLayerId = match[2] !== undefined ? Number(match[2]) : null;

      try {
        const metaUrl = new URL(serviceRoot);
        metaUrl.searchParams.set("f", "json");
        if (token) metaUrl.searchParams.set("token", token);

        const res = await fetch(metaUrl.toString());
        if (!res.ok) {
          if (configuredLayerId !== null) return cleanUrl;
          return preferredGeomType === "esriGeometryPolyline" ? null : `${serviceRoot}/0`;
        }
        const info = await res.json().catch(() => null);
        if (info?.error) {
          console.warn("ArcGIS service metadata error:", serviceRoot, info.error);
          if (configuredLayerId !== null) return cleanUrl;
          return preferredGeomType === "esriGeometryPolyline" ? null : `${serviceRoot}/0`;
        }

        const layers = Array.isArray(info?.layers) ? info.layers : [];
        if (layers.length === 0) {
          if (configuredLayerId !== null) return cleanUrl;
          return preferredGeomType === "esriGeometryPolyline" ? null : `${serviceRoot}/0`;
        }

        const needsSublayerCount =
          preferredGeomType === "esriGeometryPolyline" && layers.length > 1;
        const detailedLayers = await Promise.all(
          layers.map((l) => fetchSublayerDetails(serviceRoot, l, token, needsSublayerCount))
        );

        const geomMatches = preferredGeomType
          ? detailedLayers.filter((l) => l.geometryType === preferredGeomType)
          : detailedLayers;

        const nonEmptyMatches = geomMatches.filter((l) => l.count === null || l.count > 0);
        const pool = nonEmptyMatches.length > 0 ? nonEmptyMatches : geomMatches;

        if (pool.length > 0) {
          const configuredMatch =
            configuredLayerId !== null
              ? pool.find((l) => Number(l.id) === configuredLayerId)
              : null;
          if (configuredMatch) return configuredMatch.url;

          if (preferredGeomType === "esriGeometryPolyline") {
            const routeNamed = pool.find(
              (l) => /route/i.test(l.name) && !/direction/i.test(l.name)
            );
            if (routeNamed) return routeNamed.url;
          }
          return pool[0].url;
        }

        // If caller passed a bare /FeatureServer URL for route and the service has no polyline sublayer, skip route cleanly
        if (configuredLayerId === null && preferredGeomType === "esriGeometryPolyline") {
          return null;
        }

        const existingConfigured =
          configuredLayerId !== null
            ? detailedLayers.find((l) => Number(l.id) === configuredLayerId)
            : null;
        return (existingConfigured || detailedLayers[0]).url;
      } catch (err) {
        console.warn("Service metadata inspection skipped for", cleanUrl, err);
        if (configuredLayerId !== null) return cleanUrl;
        return preferredGeomType === "esriGeometryPolyline" ? null : `${serviceRoot}/0`;
      }
    }

    const OfflineDB = window.FieldOfflineDB || null;

    function isLikelyNetworkError(err) {
      if (!navigator.onLine) return true;
      const msg = String(err?.message || err || "").toLowerCase();
      if (
        msg.includes("failed to fetch") ||
        msg.includes("network") ||
        msg.includes("load failed") ||
        msg.includes("timeout") ||
        msg.includes("offline") ||
        msg.includes("abort")
      ) {
        return true;
      }
      if (err?.details?.httpStatus === 0 || err?.name === "TypeError") {
        return true;
      }
      return false;
    }

    function serializeFeatureForCache(f) {
      const coords = extractLatLng(f.geometry);
      return {
        attributes: { ...(f.attributes || {}) },
        geometry: coords ? { longitude: coords.lng, latitude: coords.lat } : null
      };
    }

    async function persistLayerCache(layer, features) {
      if (!OfflineDB || isDemoMode || isOfflineCacheMode || !layer) return;
      try {
        const oidField = layer.objectIdField || "OBJECTID";
        const safeFields = (layer.fields || [])
          .filter((fld) => fld.type && fld.type !== "geometry")
          .map((fld) => ({
            name: fld.name,
            alias: fld.alias || fld.name,
            type: fld.type === "global-id" || fld.type === "guid" ? "string" : fld.type,
            length: fld.length || undefined
          }));

        await OfflineDB.saveLayerCache(POINTS_CACHE_KEY, {
          serviceUrl: resolvedPointsServiceUrl || ACTIVE_POINTS_URL,
          objectIdField: oidField,
          activeOrderField,
          activeStatusField,
          activeNameField,
          fields: safeFields,
          features: (features || []).map(serializeFeatureForCache)
        });
      } catch (err) {
        console.warn("Could not persist offline points cache:", err);
      }
    }

    async function persistRouteCache(layer) {
      if (!OfflineDB || isDemoMode || isOfflineCacheMode || !layer || layer.type !== "feature") {
        return;
      }
      try {
        const res = await layer.queryFeatures({
          where: "1=1",
          outFields: [],
          returnGeometry: true,
          outSpatialReference: { wkid: 4326 }
        });
        const polylines = (res.features || [])
          .filter((f) => f.geometry?.paths)
          .map((f) => f.geometry.paths);

        await OfflineDB.saveLayerCache(ROUTE_CACHE_KEY, {
          serviceUrl: resolvedRouteServiceUrl || ACTIVE_ROUTE_URL,
          pathsList: polylines
        });
      } catch (err) {
        console.warn("Could not persist offline route cache:", err);
      }
    }

    function createCachedOfflineFeatureLayer(cacheData) {
      const oidField = cacheData.objectIdField || "OBJECTID";
      if (cacheData.activeOrderField) activeOrderField = cacheData.activeOrderField;
      if (cacheData.activeStatusField !== undefined) {
        activeStatusField = cacheData.activeStatusField;
      }
      if (cacheData.activeNameField !== undefined) {
        activeNameField = cacheData.activeNameField;
      } else {
        activeNameField = resolveNameFieldName(cacheData.fields);
      }

      const sourceGraphics = (cacheData.features || [])
        .filter((item) => item.geometry)
        .map(
          (item) =>
            new Graphic({
              geometry: new Point({
                longitude: item.geometry.longitude,
                latitude: item.geometry.latitude,
                spatialReference: { wkid: 4326 }
              }),
              attributes: { ...(item.attributes || {}) }
            })
        );

      let fields = Array.isArray(cacheData.fields) ? [...cacheData.fields] : [];
      if (!fields.some((f) => f.name === oidField)) {
        fields.unshift({ name: oidField, alias: oidField, type: "oid" });
      }

      return new FeatureLayer({
        source: sourceGraphics,
        objectIdField: oidField,
        geometryType: "point",
        spatialReference: { wkid: 4326 },
        fields,
        popupEnabled: false,
        minScale: 0,
        maxScale: 0,
        renderer: createPointsRenderer(activeStatusField),
        labelingInfo: createNumberedLabeling(activeOrderField, activeStatusField, activeNameField)
      });
    }

    async function activateOfflineCacheFallback() {
      if (!OfflineDB) return false;
      const pointsCache = await OfflineDB.getLayerCache(POINTS_CACHE_KEY).catch(() => null);
      if (!pointsCache || !Array.isArray(pointsCache.features) || pointsCache.features.length === 0) {
        return false;
      }

      isOfflineCacheMode = true;
      if (pointsCache.serviceUrl) {
        resolvedPointsServiceUrl = pointsCache.serviceUrl;
      }

      if (routeLayer) map.remove(routeLayer);
      if (pointsLayer) map.remove(pointsLayer);

      const routeCache = await OfflineDB.getLayerCache(ROUTE_CACHE_KEY).catch(() => null);
      if (routeCache && Array.isArray(routeCache.pathsList) && routeCache.pathsList.length > 0) {
        const offlineRouteLayer = new GraphicsLayer({
          id: "offline-route-cache",
          opacity: 0.85
        });
        const lineSymbol = getRouteLineSymbol();
        routeCache.pathsList.forEach((paths) => {
          offlineRouteLayer.add(
            new Graphic({
              geometry: new Polyline({ paths, spatialReference: { wkid: 4326 } }),
              symbol: lineSymbol
            })
          );
        });
        routeLayer = offlineRouteLayer;
      } else {
        routeLayer = null;
      }

      pointsLayer = createCachedOfflineFeatureLayer(pointsCache);
      map.addMany([routeLayer, pointsLayer].filter(Boolean));
      await pointsLayer.load();
      await loadAndSyncPoints(true);

      showToast(
        `📡 وضع بدون إنترنت: تم تحميل ${pointsCache.features.length} نقطة من الذاكرة المحلية`,
        "info",
        5000
      );
      return true;
    }

    let liveUpgradePromise = null;
    async function upgradeOfflineLayerToLive() {
      if (!isOfflineCacheMode && pointsLayer && pointsLayer.type === "feature" && pointsLayer.url) {
        return;
      }
      if (liveUpgradePromise) return liveUpgradePromise;

      liveUpgradePromise = (async () => {
        if (routeLayer) map.remove(routeLayer);
        if (pointsLayer) map.remove(pointsLayer);
        isOfflineCacheMode = false;
        await initializeLayers(false);
      })();

      try {
        await liveUpgradePromise;
      } finally {
        liveUpgradePromise = null;
      }
    }

    async function initializeLayers(useDemo) {
      isDemoMode = useDemo;
      isOfflineCacheMode = false;
      els.demoBadge.classList.toggle("visible", useDemo);

      let tokenError = null;
      let accessToken = null;
      if (!useDemo) {
        const tokenRes = await registerEsriTokenFromServer();
        accessToken = tokenRes.token;
        tokenError = tokenRes.error;
      }

      const [resolvedRouteUrl, resolvedPointsUrl] = useDemo
        ? [ACTIVE_ROUTE_URL, ACTIVE_POINTS_URL]
        : await Promise.all([
            resolveFeatureLayerUrl(ACTIVE_ROUTE_URL, accessToken, "esriGeometryPolyline"),
            resolveFeatureLayerUrl(ACTIVE_POINTS_URL, accessToken, "esriGeometryPoint")
          ]);

      resolvedPointsServiceUrl = resolvedPointsUrl || ACTIVE_POINTS_URL;
      resolvedRouteServiceUrl = resolvedRouteUrl || ACTIVE_ROUTE_URL;
      console.info("Resolved layer URLs:", { resolvedPointsUrl, resolvedRouteUrl });

      if (resolvedRouteUrl && resolvedRouteUrl.trim() !== "") {
        routeLayer = new FeatureLayer({
          url: resolvedRouteUrl,
          outFields: ["*"],
          popupEnabled: false,
          opacity: 0.85,
          minScale: 0,
          maxScale: 0,
          renderer: new SimpleRenderer({
            symbol: getRouteLineSymbol()
          })
        });
      } else if (!ACTIVE_ROUTE_URL || ACTIVE_ROUTE_URL.trim() === "") {
        routeLayer = new GraphicsLayer({ id: "auto-route-layer", opacity: 0.8 });
      } else {
        routeLayer = null;
      }

      if (useDemo) {
        pointsLayer = createDemoFeatureLayer();
      } else {
        pointsLayer = new FeatureLayer({
          url: resolvedPointsUrl,
          outFields: ["*"],
          popupEnabled: false,
          minScale: 0,
          maxScale: 0,
          renderer: createPointsRenderer(activeStatusField)
        });
      }

      map.addMany([routeLayer, pointsLayer].filter(Boolean));

      if (routeLayer && routeLayer.type === "feature") {
        routeLayer
          .load()
          .then(async () => {
            console.info("Route layer loaded:", {
              url: routeLayer.url,
              geometryType: routeLayer.geometryType
            });
            if (routeLayer.geometryType && routeLayer.geometryType !== "polyline") {
              showToast(
                `تنبيه: طبقة المسار (${routeLayer.url}) نوعها ${routeLayer.geometryType} وليست خطوطاً`,
                "error",
                6500
              );
              return;
            }
            const routeCount = await routeLayer.queryFeatureCount().catch(() => null);
            console.info("Route feature count:", routeCount);
            if (routeCount === 0) {
              showToast("طبقة المسار محملة لكنها فارغة (0 خطوط)", "error", 6000);
            } else {
              persistRouteCache(routeLayer);
            }
          })
          .catch((err) => {
            console.warn("Failed to load route layer:", err);
          });
      }

      try {
        await pointsLayer.load();
        console.info(
          "Points layer fields:",
          (pointsLayer.fields || []).map((f) => f.name)
        );
        activeOrderField = resolveOrderFieldName(pointsLayer.fields);
        activeStatusField = resolveStatusFieldName(pointsLayer.fields);
        activeNameField = resolveNameFieldName(pointsLayer.fields);
        pointsLayer.renderer = createPointsRenderer(activeStatusField);
        pointsLayer.labelingInfo = createNumberedLabeling(
          activeOrderField,
          activeStatusField,
          activeNameField
        );
        if (activeStatusField) {
          pointsLayer.orderBy = [{ field: activeStatusField, order: "ascending" }];
        }
        await loadAndSyncPoints(true);
      } catch (err) {
        console.error("Failed to load points layer:", err);
        const restoredOffline = !useDemo ? await activateOfflineCacheFallback() : false;
        if (!restoredOffline) {
          const reason = tokenError
            ? `مشكلة توكن ArcGIS: ${tokenError}`
            : err?.message || "تأكد من رابط الطبقة وصلاحيات الوصول";
          els.progressText.textContent = "تعذر تحميل طبقة النقاط";
          showToast(`فشل تحميل طبقة النقاط: ${reason}`, "error", 7000);
        }
      }
    }

    function createDemoFeatureLayer() {
      const baseLat = 24.7136;
      const baseLng = 46.6753;
      const nowMs = Date.now();
      const samplePoints = [
        {
          name: "1. UN-009",
          district: "الرصيفة",
          streetName: "طريق الملك عبدالعزيز",
          order: 1,
          status: STATUS_VALUES.completed,
          date: nowMs - 86400000,
          decision: "استلام الموقع",
          hasBase: "نعم",
          notes: "تم الاستلام والموقع جاهز"
        },
        {
          name: "2. MG-095",
          district: "الشوقية",
          streetName: "شارع عبدالله عريف",
          order: 2,
          status: STATUS_VALUES.completed,
          date: nowMs - 86400000,
          decision: "استلام الموقع مع ملاحظات",
          hasBase: "نعم",
          notes: "يحتاج تسوية بسيطة بالرصيف"
        },
        { name: "3. UN-080", district: "العزيزية", streetName: "شارع المسجد الحرام", order: 3, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "4. UN-040", district: "العزيزية", streetName: "شارع الشيخ عبدالله خياط", order: 4, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "5. MG-092", district: "العوالي", streetName: "طريق إبراهيم الجفالي", order: 5, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "6. MG-116", district: "بطحاء قريش", streetName: "شارع جبل ثور", order: 6, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" }
      ];

      const sourceGraphics = samplePoints.map((pt, idx) => {
        const offsetLat = (idx % 2 === 0 ? 1 : -0.6) * idx * 0.0045;
        const offsetLng = idx * 0.006;
        return new Graphic({
          geometry: new Point({
            longitude: baseLng + offsetLng,
            latitude: baseLat + offsetLat
          }),
          attributes: {
            OBJECTID: idx + 1,
            [ACTIVE_FIELDS.name || "Name"]: pt.name,
            [ACTIVE_FIELDS.district || "district"]: pt.district || "",
            [ACTIVE_FIELDS.streetName || "street_name"]: pt.streetName || "",
            [ACTIVE_FIELDS.order]: pt.order,
            [ACTIVE_FIELDS.status]: pt.status,
            [ACTIVE_FIELDS.actualHandoverDate]: pt.date,
            [ACTIVE_FIELDS.committeeDecision]: pt.decision,
            [ACTIVE_FIELDS.hasBase]: pt.hasBase,
            [ACTIVE_FIELDS.notesObstacles]: pt.notes,
            [ACTIVE_FIELDS.stage || "stage"]: pt.order === 1 ? "حفر واستلام حفر" : "",
            [ACTIVE_FIELDS.notes || "notes"]: pt.notes
          }
        });
      });

      return new FeatureLayer({
        source: sourceGraphics,
        objectIdField: "OBJECTID",
        geometryType: "point",
        spatialReference: { wkid: 4326 },
        fields: [
          { name: "OBJECTID", alias: "OBJECTID", type: "oid" },
          { name: ACTIVE_FIELDS.name || "Name", alias: "Name", type: "string", length: 100, editable: false },
          { name: ACTIVE_FIELDS.district || "district", alias: "الحي", type: "string", length: 150, editable: false },
          { name: ACTIVE_FIELDS.streetName || "street_name", alias: "اسم الشارع", type: "string", length: 200, editable: false },
          { name: ACTIVE_FIELDS.order, alias: "رقم المحطة", type: "integer", editable: false },
          { name: ACTIVE_FIELDS.status, alias: "الحالة", type: "string", editable: true },
          { name: ACTIVE_FIELDS.actualHandoverDate, alias: "تاريخ الاستلام الفعلي", type: "date", editable: true },
          { name: ACTIVE_FIELDS.committeeDecision, alias: "قرار لجنة التسليم", type: "string", length: 150, editable: true },
          { name: ACTIVE_FIELDS.hasBase, alias: "يوجد قاعدة بالموقع", type: "string", length: 20, editable: true },
          { name: ACTIVE_FIELDS.notesObstacles, alias: "الملاحظات / المعوقات", type: "string", length: 500, editable: true },
          { name: ACTIVE_FIELDS.stage || "stage", alias: "المرحلة", type: "string", length: 100, editable: true },
          { name: ACTIVE_FIELDS.notes || "notes", alias: "الملاحظات", type: "string", length: 500, editable: true }
        ],
        popupEnabled: false,
        renderer: createPointsRenderer(),
        labelingInfo: createNumberedLabeling(
          ACTIVE_FIELDS.order,
          ACTIVE_FIELDS.status,
          ACTIVE_FIELDS.name || "Name"
        ),
        orderBy: [{ field: ACTIVE_FIELDS.status, order: "ascending" }]
      });
    }

    // --- Query, Route Generation, Progress & Offline Cache Sync ---
    async function getModeOutboxItems() {
      if (!OfflineDB || isDemoMode) return [];
      const all = await OfflineDB.getAllOutbox().catch(() => []);
      return all.filter((item) => (item.mode || "handover") === APP_MODE);
    }

    async function applyOutboxOverlayToFeatures(features) {
      if (!OfflineDB || !Array.isArray(features) || features.length === 0) return;
      const outbox = await getModeOutboxItems();
      if (outbox.length === 0) return;

      const oidField = pointsLayer?.objectIdField || "OBJECTID";
      const outboxByOid = new Map(outbox.map((item) => [String(item.objectId), item]));

      features.forEach((f) => {
        const oid = f.attributes?.[oidField];
        const queued = oid !== undefined ? outboxByOid.get(String(oid)) : null;
        if (queued?.attributes) {
          Object.assign(f.attributes, queued.attributes);
        }
      });
    }

    async function loadAndSyncPoints(shouldZoomAll = false) {
      if (!pointsLayer) return;

      const query = pointsLayer.createQuery();
      query.where = "1=1";
      query.outFields = ["*"];
      query.returnGeometry = true;
      query.outSpatialReference = view.spatialReference;

      const featureSet = await pointsLayer.queryFeatures(query);
      const rawFeatures = featureSet.features || [];

      if (!isDemoMode && !isOfflineCacheMode && rawFeatures.length > 0) {
        persistLayerCache(pointsLayer, rawFeatures);
      }

      await applyOutboxOverlayToFeatures(rawFeatures);
      cachedFeatures = sortFeaturesByOrder(rawFeatures);

      updateProgressUI(cachedFeatures);
      await refreshOutboxUI();

      if (!ACTIVE_ROUTE_URL || ACTIVE_ROUTE_URL.trim() === "") {
        drawAutoRoute(cachedFeatures);
      }

      if ((shouldZoomAll || !initialZoomDone) && cachedFeatures.length > 0) {
        initialZoomDone = true;
        zoomToAllPoints();
      }
    }

    function sortFeaturesByOrder(features) {
      return [...features].sort((a, b) => {
        const valA = Number(getStopOrderValue(a.attributes));
        const valB = Number(getStopOrderValue(b.attributes));
        const numA = Number.isFinite(valA) ? valA : Number.MAX_SAFE_INTEGER;
        const numB = Number.isFinite(valB) ? valB : Number.MAX_SAFE_INTEGER;
        return numA - numB;
      });
    }

    function isCompletedStatus(statusVal) {
      if (statusVal === null || statusVal === undefined) return false;
      return (
        String(statusVal).trim().toLowerCase() ===
        String(STATUS_VALUES.completed).trim().toLowerCase()
      );
    }

    function updateProgressUI(features) {
      const total = features.length;
      const completed = features.filter((f) =>
        isCompletedStatus(getStopStatusValue(f.attributes))
      ).length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

      els.progressText.textContent = `تم إنجاز ${completed} من ${total} نقطة`;
      els.progressPercent.textContent = `${pct}%`;
      els.progressFill.style.width = `${pct}%`;
    }

    function buildGoogleMapsDirectionsUrl(destCoords) {
      if (!destCoords) return "#";
      const params = new URLSearchParams({
        api: "1",
        destination: `${destCoords.lat},${destCoords.lng}`,
        travelmode: "driving"
      });
      const gpsCoords = extractLatLng(track?.graphic?.geometry);
      if (gpsCoords) {
        params.set("origin", `${gpsCoords.lat},${gpsCoords.lng}`);
      }
      return `https://www.google.com/maps/dir/?${params.toString()}`;
    }

    function drawAutoRoute(sortedFeatures) {
      if (!routeLayer || routeLayer.type !== "graphics") return;
      routeLayer.removeAll();

      const path = sortedFeatures
        .filter((f) => f.geometry && typeof f.geometry.x === "number" && typeof f.geometry.y === "number")
        .map((f) => [f.geometry.x, f.geometry.y]);

      if (path.length < 2) return;

      const polyline = new Polyline({
        paths: [path],
        spatialReference: view.spatialReference
      });

      const routeGraphic = new Graphic({
        geometry: polyline,
        symbol: new SimpleLineSymbol({
          color: [148, 163, 184, 1],
          width: 3,
          style: "solid"
        })
      });

      routeLayer.add(routeGraphic);
    }

    function zoomToAllPoints() {
      const geometries = cachedFeatures.map((f) => f.geometry).filter(Boolean);
      if (geometries.length === 0) return;

      const target =
        geometries.length === 1
          ? { target: geometries[0], zoom: 16 }
          : { target: geometries };

      view.goTo(target, { duration: 650, easing: "ease-out" }).catch(() => {});
    }

    // --- Map Interactions & Floating Buttons ---

    els.btnMyLocation.addEventListener("click", () => {
      if (track.graphic && track.graphic.geometry) {
        view
          .goTo(
            { target: track.graphic.geometry, zoom: Math.max(view.zoom, 16) },
            { duration: 600 }
          )
          .catch(() => {});
      } else {
        try {
          track.start();
          showToast("جاري تحديد موقعك الحالي...", "info");
        } catch (err) {
          showToast("تعذر الوصول إلى نظام تحديد المواقع GPS.", "error");
        }
      }
    });

    els.btnZoomAll.addEventListener("click", zoomToAllPoints);

    view.on("click", async (event) => {
      if (!pointsLayer) return;
      try {
        const hit = await view.hitTest(event, { include: [pointsLayer] });
        const result = hit.results.find((r) => r.graphic && r.graphic.layer === pointsLayer);
        if (result && result.graphic) {
          openBottomSheet(result.graphic);
        }
      } catch (err) {
        console.error("Map click hitTest error:", err);
      }
    });

    // --- Bottom Sheet Form (Exact 4 Handover Fields) ---
    const DECISIONS_REQUIRING_NOTES = new Set([
      "استلام الموقع مع ملاحظات",
      "رفض استلام الموقع لوجود عائق يمنع التنفيذ"
    ]);

    function syncNotesRequirement() {
      if (IS_EXEC_MODE || !els.fieldCommitteeDecision || !els.fieldNotesObstacles) return;
      const decision = els.fieldCommitteeDecision.value;
      const needsNotes = DECISIONS_REQUIRING_NOTES.has(decision);
      els.fieldNotesObstacles.required = needsNotes;
      if (els.notesRequiredBadge) {
        els.notesRequiredBadge.hidden = !needsNotes;
      }
    }

    if (els.fieldCommitteeDecision) {
      els.fieldCommitteeDecision.addEventListener("change", syncNotesRequirement);
    }

    let bottomSheetOpenSeq = 0;

    async function openBottomSheet(graphic) {
      const openSeq = ++bottomSheetOpenSeq;
      const oidField = pointsLayer.objectIdField || "OBJECTID";
      const oid = graphic.attributes?.[oidField];
      const fullGraphic =
        cachedFeatures.find((f) => f.attributes?.[oidField] === oid) || graphic;

      activeFeature = fullGraphic;
      resetPhotoState();
      hideFormError();

      let outboxItem = null;
      if (!isDemoMode && OfflineDB && oid !== undefined && oid !== null) {
        const outboxId = OfflineDB.makeOutboxId(
          resolvedPointsServiceUrl || ACTIVE_POINTS_URL,
          oid
        );
        outboxItem = await OfflineDB.getOutboxItem(outboxId).catch(() => null);
        if (openSeq !== bottomSheetOpenSeq || !activeFeature) return;
      }

      openedWithOutboxDraft = Boolean(outboxItem);
      const baseAttrs = fullGraphic.attributes || {};
      const attrs = outboxItem?.attributes
        ? { ...baseAttrs, ...outboxItem.attributes }
        : baseAttrs;
      const orderVal = getStopOrderValue(attrs) ?? "--";
      const pointCode = getCleanPointCode(attrs);
      const completed = isCompletedStatus(getStopStatusValue(attrs));

      els.sheetTitle.textContent = pointCode
        ? `محطة #${orderVal} (${pointCode})`
        : `محطة رقم #${orderVal}`;

      if (outboxItem) {
        els.sheetStatusBadge.textContent = "بانتظار الرفع (أوفلاين)";
        els.sheetStatusBadge.className = "status-badge pending";
      } else {
        els.sheetStatusBadge.textContent = completed ? "مكتملة" : "قيد الانتظار";
        els.sheetStatusBadge.className = `status-badge ${completed ? "completed" : "pending"}`;
      }
      els.submitBtnText.textContent = completed ? "حفظ التعديلات" : "حفظ وإتمام النقطة";

      if (els.btnSheetGoogleMaps) {
        const pointCoords = extractLatLng(fullGraphic.geometry || graphic.geometry);
        if (pointCoords) {
          els.btnSheetGoogleMaps.href = buildGoogleMapsDirectionsUrl(pointCoords);
          els.btnSheetGoogleMaps.hidden = false;
        } else {
          els.btnSheetGoogleMaps.href = "#";
          els.btnSheetGoogleMaps.hidden = true;
        }
      }

      if (outboxItem) {
        pendingDeleteAttachmentIds = Array.isArray(outboxItem.deleteAttachmentIds)
          ? [...outboxItem.deleteAttachmentIds]
          : [];
        if (Array.isArray(outboxItem.photos) && outboxItem.photos.length > 0) {
          selectedPhotos = outboxItem.photos.map((p) => {
            const blob = new Blob([p.buffer], { type: p.type || "image/jpeg" });
            return {
              id: ++photoIdCounter,
              blob,
              dataUrl: URL.createObjectURL(blob),
              filename: p.filename || `field_photo_${photoIdCounter}.jpg`,
              size: p.size || blob.size,
              isObjectUrl: true
            };
          });
          renderPhotoGallery();
        }
      }

      populateFixedFormFields(attrs);
      loadExistingAttachments(oid);

      els.sheetBackdrop.classList.add("open");
      els.bottomSheet.classList.add("open");
    }

    if (els.btnSheetGoogleMaps) {
      els.btnSheetGoogleMaps.addEventListener("click", () => {
        if (!activeFeature) return;
        const pointCoords = extractLatLng(activeFeature.geometry);
        if (pointCoords) {
          els.btnSheetGoogleMaps.href = buildGoogleMapsDirectionsUrl(pointCoords);
        }
      });
    }

    function closeBottomSheet() {
      els.sheetBackdrop.classList.remove("open");
      els.bottomSheet.classList.remove("open");
      activeFeature = null;
      resetPhotoState();
      hideFormError();
    }

    els.btnCloseSheet.addEventListener("click", closeBottomSheet);
    els.sheetBackdrop.addEventListener("click", closeBottomSheet);

    function resolveLayerFieldName(preferredName) {
      const fallback = preferredName || "";
      const fields = pointsLayer?.fields;
      if (!Array.isArray(fields) || fields.length === 0 || !fallback) {
        return fallback;
      }
      const match = fields.find(
        (f) => f.name?.toLowerCase() === fallback.toLowerCase()
      );
      return match ? match.name : fallback;
    }

    function readAttrCaseInsensitive(attrs, preferredName) {
      if (!attrs || !preferredName) return undefined;
      const exactKey = resolveLayerFieldName(preferredName);
      if (attrs[exactKey] !== undefined) return attrs[exactKey];
      const ciKey = Object.keys(attrs).find(
        (k) => k.toLowerCase() === preferredName.toLowerCase()
      );
      return ciKey ? attrs[ciKey] : undefined;
    }

    function populateFixedFormFields(attrs) {
      if (IS_EXEC_MODE) {
        const stageField = ACTIVE_FIELDS.stage || "stage";
        const notesField = ACTIVE_FIELDS.notes || "notes";

        const savedStage = readAttrCaseInsensitive(attrs, stageField);
        if (els.fieldExecStage) {
          els.fieldExecStage.value = savedStage ? String(savedStage) : "";
        }
        if (els.fieldExecNotes) {
          els.fieldExecNotes.value = readAttrCaseInsensitive(attrs, notesField) ?? "";
        }
        return;
      }

      const decisionField = ACTIVE_FIELDS.committeeDecision || "committee_decision";
      const hasBaseField = ACTIVE_FIELDS.hasBase || "has_base";
      const notesField = ACTIVE_FIELDS.notesObstacles || "notes_obstacles";

      const savedDecision = readAttrCaseInsensitive(attrs, decisionField);
      if (els.fieldCommitteeDecision) {
        els.fieldCommitteeDecision.value = savedDecision ? String(savedDecision) : "";
      }

      const savedHasBase = readAttrCaseInsensitive(attrs, hasBaseField);
      if (els.fieldHasBase) {
        els.fieldHasBase.value = savedHasBase ? String(savedHasBase) : "";
      }

      if (els.fieldNotesObstacles) {
        els.fieldNotesObstacles.value = readAttrCaseInsensitive(attrs, notesField) ?? "";
      }
      syncNotesRequirement();
    }

    function buildAttachmentAuthUrl(rawUrl) {
      if (!rawUrl) return "";
      if (/[?&]token=/i.test(rawUrl)) return rawUrl;
      try {
        const cred = IdentityManager.findCredential(rawUrl);
        if (cred?.token) {
          const sep = rawUrl.includes("?") ? "&" : "?";
          return `${rawUrl}${sep}token=${encodeURIComponent(cred.token)}`;
        }
      } catch (err) {}
      return rawUrl;
    }

    function renderExistingAttachments() {
      els.existingPhotosList.innerHTML = "";
      const deleteSet = new Set(pendingDeleteAttachmentIds);
      const visibleAttachments = existingAttachments.filter((att) => !deleteSet.has(att.id));
      const visibleCount = visibleAttachments.length;
      const deleteCount = pendingDeleteAttachmentIds.length;

      els.existingPhotosList.hidden = visibleCount === 0;
      if (els.existingPhotosCountLabel) {
        els.existingPhotosCountLabel.hidden = visibleCount === 0;
        els.existingPhotosCountLabel.textContent =
          visibleCount === 1
            ? "صورة واحدة"
            : visibleCount === 2
              ? "صورتان"
              : `${visibleCount} صور`;
      }

      visibleAttachments.forEach((att) => {
        const card = document.createElement("div");
        card.className = "photo-thumb-card";

        const imgUrl = buildAttachmentAuthUrl(att.url);
        const img = document.createElement("img");
        img.src = imgUrl;
        img.alt = att.name || "مرفق";
        img.className = "photo-thumb-img";
        img.title = "اضغط لعرض الصورة بملء الشاشة";
        img.addEventListener("click", () => {
          openPhotoViewer(imgUrl, att.name || "صورة مرفقة");
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "photo-thumb-remove";
        removeBtn.setAttribute("aria-label", "حذف الصورة المرفقة");
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!pendingDeleteAttachmentIds.includes(att.id)) {
            pendingDeleteAttachmentIds.push(att.id);
          }
          renderExistingAttachments();
        });

        const badge = document.createElement("div");
        badge.className = "photo-thumb-size";
        badge.textContent = att.size ? formatBytes(att.size) : "محفوظة";

        card.appendChild(img);
        card.appendChild(removeBtn);
        card.appendChild(badge);
        els.existingPhotosList.appendChild(card);
      });

      if (els.existingPhotosUndoBar && els.existingPhotosDeleteNotice) {
        els.existingPhotosUndoBar.hidden = deleteCount === 0;
        if (deleteCount > 0) {
          els.existingPhotosDeleteNotice.textContent =
            deleteCount === 1
              ? "تم تحديد صورة واحدة للحذف عند الحفظ"
              : `تم تحديد ${deleteCount} صور للحذف عند الحفظ`;
        }
      }

      els.existingPhotosSection.hidden = visibleCount === 0 && deleteCount === 0;
    }

    if (els.btnUndoDeletePhotos) {
      els.btnUndoDeletePhotos.addEventListener("click", () => {
        pendingDeleteAttachmentIds = [];
        renderExistingAttachments();
      });
    }

    async function loadExistingAttachments(objectId) {
      existingAttachments = [];
      renderExistingAttachments();

      if (
        isDemoMode ||
        isOfflineCacheMode ||
        !navigator.onLine ||
        !objectId ||
        pointsLayer?.capabilities?.data?.supportsAttachment === false
      ) {
        return;
      }

      try {
        const result = await pointsLayer.queryAttachments({
          objectIds: [objectId]
        });
        const attachments = result?.[objectId] || [];
        existingAttachments = attachments.filter(
          (att) => att.url && /^image\//i.test(att.contentType || "image/")
        );
        renderExistingAttachments();
      } catch (err) {
        console.warn("Could not load existing attachments:", err);
      }
    }

    // --- Multi-Photo Capture, Watermark, Compression & Gallery ---
    els.btnPickPhoto.addEventListener("click", () => {
      els.photoInput.click();
    });

    els.photoInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      // Reset input immediately so mobile camera can capture another photo next time
      els.photoInput.value = "";
      if (files.length === 0) return;

      hideFormError();
      const watermarkEnabled =
        typeof IMAGE_WATERMARK === "undefined" || IMAGE_WATERMARK.enabled;

      const origBtnText = els.btnPickPhoto.textContent;
      els.btnPickPhoto.disabled = true;
      els.btnPickPhoto.textContent = "جاري معالجة الصور...";

      try {
        const watermarkInfo = watermarkEnabled ? await buildWatermarkInfo() : null;

        for (const file of files) {
          if (IMAGE_COMPRESSION.enabled || watermarkEnabled) {
            const processed = await processPhotoOnCanvas(file, {
              maxWidth: IMAGE_COMPRESSION.enabled ? IMAGE_COMPRESSION.maxWidth : Infinity,
              quality: IMAGE_COMPRESSION.enabled ? IMAGE_COMPRESSION.quality : 0.92,
              watermarkInfo
            });
            selectedPhotos.push({
              id: ++photoIdCounter,
              blob: processed.blob,
              dataUrl: processed.dataUrl,
              filename: buildJpgFilename(file.name, photoIdCounter),
              size: processed.compressedSize
            });
          } else {
            selectedPhotos.push({
              id: ++photoIdCounter,
              blob: file,
              dataUrl: URL.createObjectURL(file),
              filename: file.name || `field_photo_${photoIdCounter}.jpg`,
              size: file.size,
              isObjectUrl: true
            });
          }
        }

        renderPhotoGallery();
      } catch (err) {
        console.error("Image processing error:", err);
        showFormError("تعذر معالجة إحدى الصور المختارة. يرجى المحاولة مرة أخرى.");
      } finally {
        els.btnPickPhoto.disabled = false;
        els.btnPickPhoto.textContent = origBtnText;
      }
    });

    function renderPhotoGallery() {
      els.photoGallery.innerHTML = "";
      const count = selectedPhotos.length;

      els.photoGallery.hidden = count === 0;
      els.photoCountLabel.hidden = count === 0;
      els.photoCountLabel.textContent =
        count === 1 ? "صورة واحدة" : count === 2 ? "صورتان" : `${count} صور`;

      selectedPhotos.forEach((photo) => {
        const card = document.createElement("div");
        card.className = "photo-thumb-card";

        const img = document.createElement("img");
        img.src = photo.dataUrl;
        img.alt = photo.filename;
        img.className = "photo-thumb-img";
        img.title = "اضغط لعرض الصورة بملء الشاشة";
        img.addEventListener("click", () => {
          openPhotoViewer(photo.dataUrl, photo.filename || "صورة الموقع");
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "photo-thumb-remove";
        removeBtn.setAttribute("aria-label", "حذف الصورة");
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          removeQueuedPhoto(photo.id);
        });

        const sizeBadge = document.createElement("div");
        sizeBadge.className = "photo-thumb-size";
        sizeBadge.textContent = formatBytes(photo.size);

        card.appendChild(img);
        card.appendChild(removeBtn);
        card.appendChild(sizeBadge);
        els.photoGallery.appendChild(card);
      });
    }

    function removeQueuedPhoto(photoId) {
      const target = selectedPhotos.find((p) => p.id === photoId);
      if (target?.isObjectUrl && target.dataUrl) {
        URL.revokeObjectURL(target.dataUrl);
      }
      selectedPhotos = selectedPhotos.filter((p) => p.id !== photoId);
      renderPhotoGallery();
    }

    function resetPhotoState() {
      selectedPhotos.forEach((p) => {
        if (p.isObjectUrl && p.dataUrl) {
          URL.revokeObjectURL(p.dataUrl);
        }
      });
      selectedPhotos = [];
      existingAttachments = [];
      pendingDeleteAttachmentIds = [];
      openedWithOutboxDraft = false;
      els.photoInput.value = "";
      renderPhotoGallery();
      renderExistingAttachments();
    }

    function openPhotoViewer(src, caption = "معاينة الصورة") {
      if (!src || !els.photoViewerModal || !els.photoViewerImg) return;
      els.photoViewerImg.src = src;
      if (els.photoViewerCaption) {
        els.photoViewerCaption.textContent = caption;
      }
      els.photoViewerModal.hidden = false;
    }

    function closePhotoViewer() {
      if (!els.photoViewerModal) return;
      els.photoViewerModal.hidden = true;
      if (els.photoViewerImg) {
        els.photoViewerImg.src = "";
      }
    }

    if (els.btnClosePhotoViewer) {
      els.btnClosePhotoViewer.addEventListener("click", closePhotoViewer);
    }

    if (els.photoViewerModal) {
      els.photoViewerModal.addEventListener("click", (e) => {
        if (e.target === els.photoViewerModal || e.target.classList.contains("photo-viewer-stage")) {
          closePhotoViewer();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.photoViewerModal && !els.photoViewerModal.hidden) {
        closePhotoViewer();
      }
    });

    function buildJpgFilename(originalName, seq) {
      const base = (originalName || "field_photo").replace(/\.[^/.]+$/, "");
      return `${base}_${seq}.jpg`;
    }

    function extractLatLng(geom) {
      if (!geom) return null;
      if (typeof geom.latitude === "number" && typeof geom.longitude === "number") {
        return { lat: geom.latitude, lng: geom.longitude };
      }
      if (
        geom.spatialReference?.isWGS84 &&
        typeof geom.y === "number" &&
        typeof geom.x === "number"
      ) {
        return { lat: geom.y, lng: geom.x };
      }
      if (
        geom.spatialReference?.isWebMercator &&
        typeof geom.y === "number" &&
        typeof geom.x === "number"
      ) {
        const lng = (geom.x / 20037508.34) * 180;
        let lat = (geom.y / 20037508.34) * 180;
        lat =
          (180 / Math.PI) *
          (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
        return { lat, lng };
      }
      return null;
    }

    function getBrowserGeolocationOnce(timeoutMs = 2500) {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: Math.round(pos.coords.accuracy || 0),
              source: "GPS"
            });
          },
          () => resolve(null),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 }
        );
      });
    }

    async function resolvePhotoLocation() {
      const trackCoords = extractLatLng(track?.graphic?.geometry);
      if (trackCoords) {
        return { ...trackCoords, source: "GPS" };
      }

      const browserCoords = await getBrowserGeolocationOnce(2500);
      if (browserCoords) {
        return browserCoords;
      }

      const featureCoords = extractLatLng(activeFeature?.geometry);
      if (featureCoords) {
        return { ...featureCoords, source: "Point" };
      }

      return null;
    }

    let cachedLogosImage = null;

    function formatWatermarkTimestamp(date) {
      const MONTHS = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ];
      const pad = (n) => String(n).padStart(2, "0");
      const dd = pad(date.getDate());
      const mmm = MONTHS[date.getMonth()];
      const yyyy = date.getFullYear();
      const hh = pad(date.getHours());
      const min = pad(date.getMinutes());
      const sec = pad(date.getSeconds());
      return `${dd} ${mmm} ${yyyy} ${hh}:${min}:${sec}`;
    }

    function formatWatermarkCoords(location) {
      if (
        !location ||
        typeof location.lat !== "number" ||
        typeof location.lng !== "number" ||
        !Number.isFinite(location.lat) ||
        !Number.isFinite(location.lng)
      ) {
        return null;
      }
      const latHem = location.lat >= 0 ? "N" : "S";
      const lngHem = location.lng >= 0 ? "E" : "W";
      return `${Math.abs(location.lat).toFixed(8)}${latHem} ${Math.abs(location.lng).toFixed(8)}${lngHem}`;
    }

    function loadImageSafe(src, useCors = false, timeoutMs = 3500) {
      return new Promise((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        let settled = false;
        const img = new Image();
        if (useCors) {
          img.crossOrigin = "anonymous";
        }

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        }, timeoutMs);

        img.onload = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(img);
          }
        };

        img.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        };

        img.src = src;
      });
    }

    async function loadWatermarkLogos() {
      if (cachedLogosImage && cachedLogosImage.complete && cachedLogosImage.naturalWidth > 0) {
        return cachedLogosImage;
      }
      const img = await loadImageSafe("../assets/logos.jpg", false, 3000);
      if (img && img.naturalWidth > 0) {
        cachedLogosImage = img;
        return img;
      }
      return null;
    }

    async function renderSatelliteMinimapSnapshot(lat, lng, snapSize = 440) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const zoom = 17;
      const scaleFactor = 1.25;
      const n = Math.pow(2, zoom);
      const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
      const latRad = (clampedLat * Math.PI) / 180;
      const xFloat = ((lng + 180) / 360) * n;
      const yFloat =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

      const renderTilePx = 256 * scaleFactor;
      const centerPxX = xFloat * renderTilePx;
      const centerPxY = yFloat * renderTilePx;

      const topLeftWorldX = centerPxX - snapSize / 2;
      const topLeftWorldY = centerPxY - snapSize / 2;

      const minTileX = Math.floor(topLeftWorldX / renderTilePx);
      const maxTileX = Math.floor((topLeftWorldX + snapSize) / renderTilePx);
      const minTileY = Math.floor(topLeftWorldY / renderTilePx);
      const maxTileY = Math.floor((topLeftWorldY + snapSize) / renderTilePx);

      const tileJobs = [];
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          const wrappedX = ((tx % n) + n) % n;
          const tileUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${wrappedX}`;
          tileJobs.push(
            loadImageSafe(tileUrl, true, 3500).then((img) => ({
              img,
              tx,
              ty
            }))
          );
        }
      }

      const loadedTiles = await Promise.all(tileJobs);
      const validTiles = loadedTiles.filter((t) => t.img && t.img.naturalWidth > 0);
      if (validTiles.length === 0) return null;

      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = snapSize;
      snapCanvas.height = snapSize;
      const snapCtx = snapCanvas.getContext("2d");
      snapCtx.fillStyle = "#1e293b";
      snapCtx.fillRect(0, 0, snapSize, snapSize);

      validTiles.forEach(({ img, tx, ty }) => {
        const destX = tx * renderTilePx - topLeftWorldX;
        const destY = ty * renderTilePx - topLeftWorldY;
        snapCtx.drawImage(img, destX, destY, renderTilePx, renderTilePx);
      });

      return snapCanvas;
    }

    function drawRedMapPin(ctx, tipX, tipY, pinHeight) {
      const r = pinHeight * 0.34;
      const circleY = tipY - pinHeight + r;

      ctx.save();
      // Subtle ground shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + 1, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      // Teardrop marker body
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = "#ea4335";
      ctx.strokeStyle = "#b31412";
      ctx.lineWidth = Math.max(1.5, pinHeight * 0.045);

      ctx.beginPath();
      ctx.arc(tipX, circleY, r, Math.PI * 0.82, Math.PI * 0.18, false);
      ctx.quadraticCurveTo(tipX + r * 0.45, circleY + r * 1.15, tipX, tipY);
      ctx.quadraticCurveTo(
        tipX - r * 0.45,
        circleY + r * 1.15,
        tipX - r * Math.cos(Math.PI * 0.18),
        circleY + r * Math.sin(Math.PI * 0.18)
      );
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.stroke();

      // Inner dark dot
      ctx.fillStyle = "#7f1d1d";
      ctx.beginPath();
      ctx.arc(tipX, circleY, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function getCleanAttrText(attrs, preferredField) {
      if (!attrs || !preferredField) return "";
      const raw = readAttrCaseInsensitive(attrs, preferredField);
      if (raw === undefined || raw === null) return "";
      const trimmed = String(raw).trim();
      if (!trimmed || /^(null|undefined|<null>)$/i.test(trimmed)) return "";
      return trimmed;
    }

    function getCleanPointCode(attrs) {
      const targetName = ACTIVE_FIELDS.name || "Name";
      const raw = getCleanAttrText(attrs, targetName);
      if (!raw) return "";
      // Strip leading index + dot/whitespace (e.g. "1. UN-009", "35. MO-056" -> "UN-009", "MO-056")
      return raw.replace(/^\d+(?:\s*\.\s*|\s+)/, "").trim();
    }

    async function buildWatermarkInfo() {
      const locationPromise = resolvePhotoLocation();
      const logosPromise = loadWatermarkLogos();
      const [location, logosImg] = await Promise.all([locationPromise, logosPromise]);

      const timestamp = formatWatermarkTimestamp(new Date());
      const coordsLine = formatWatermarkCoords(location);
      const includeOrder =
        typeof IMAGE_WATERMARK === "undefined" || IMAGE_WATERMARK.includePointOrder;
      const orderNum = getStopOrderValue(activeFeature?.attributes);
      const pointCode = getCleanPointCode(activeFeature?.attributes);
      const district = getCleanAttrText(
        activeFeature?.attributes,
        ACTIVE_FIELDS.district || "district"
      );
      const streetName = getCleanAttrText(
        activeFeature?.attributes,
        ACTIVE_FIELDS.streetName || "street_name"
      );
      const execStage = IS_EXEC_MODE
        ? els.fieldExecStage?.value?.trim() ||
          getCleanAttrText(activeFeature?.attributes, ACTIVE_FIELDS.stage || "stage")
        : "";

      const lines = [timestamp];
      if (coordsLine) {
        lines.push(coordsLine);
      } else {
        lines.push("Location: Unavailable");
      }

      if (pointCode) {
        lines.push(
          includeOrder && orderNum !== undefined && orderNum !== null
            ? `${pointCode}  (#${orderNum})`
            : pointCode
        );
      } else if (includeOrder && orderNum !== undefined && orderNum !== null) {
        lines.push(`Stop #${orderNum}`);
      }

      if (execStage) {
        lines.push(
          /[\u0600-\u06FF]/.test(execStage) ? `المرحلة: ${execStage}` : `Stage: ${execStage}`
        );
      }

      if (district) {
        const cleanDistrict = district.replace(/^حي\s+/i, "").trim();
        lines.push(
          /[\u0600-\u06FF]/.test(cleanDistrict)
            ? `الحي: ${cleanDistrict}`
            : `District: ${cleanDistrict}`
        );
      }

      if (streetName) {
        lines.push(
          /[\u0600-\u06FF]/.test(streetName)
            ? `الشارع: ${streetName}`
            : `Street: ${streetName}`
        );
      }

      const minimapCanvas = location
        ? await renderSatelliteMinimapSnapshot(location.lat, location.lng, 440)
        : null;

      return {
        lines,
        location,
        logosImg,
        minimapCanvas
      };
    }

    function drawPhotoWatermark(ctx, width, height, watermarkData) {
      if (!watermarkData) return;
      const lines = Array.isArray(watermarkData)
        ? watermarkData
        : watermarkData.lines || [];
      const logosImg = !Array.isArray(watermarkData) ? watermarkData.logosImg : null;
      const minimapCanvas = !Array.isArray(watermarkData) ? watermarkData.minimapCanvas : null;
      const location = !Array.isArray(watermarkData) ? watermarkData.location : null;

      // 1. Measure Top-Right White Logos Box (compact to keep photo prominent)
      let logoBoxW = 0;
      let logoBoxH = 0;
      let logoPad = 0;
      let logoInnerW = 0;
      let logoInnerH = 0;
      if (logosImg && logosImg.naturalWidth > 0 && logosImg.naturalHeight > 0) {
        logoBoxW = Math.round(Math.min(width * 0.28, Math.max(165, width * 0.27)));
        logoPad = Math.max(3, Math.round(logoBoxW * 0.018));
        logoInnerW = logoBoxW - logoPad * 2;
        logoInnerH = Math.round(
          logoInnerW * (logosImg.naturalHeight / logosImg.naturalWidth)
        );
        logoBoxH = logoInnerH + logoPad * 2;
      }

      // 2. Measure Top-Left Text (compact Date/Time + Coordinates + Code + District + Street)
      const padX = Math.max(10, Math.round(width * 0.014));
      const padY = Math.max(8, Math.round(width * 0.012));
      const maxTextW = Math.max(120, (logoBoxW > 0 ? width - logoBoxW : width) - padX * 2);

      let fontSize = Math.max(12, Math.round(width * 0.021));
      ctx.save();
      ctx.direction = "ltr";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      if (lines.length > 0) {
        ctx.font = `700 ${fontSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
        let widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
        while (widest > maxTextW && fontSize > 11) {
          fontSize -= 1;
          ctx.font = `700 ${fontSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
          widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
        }
      }

      const lineHeight = Math.round(fontSize * 1.22);
      const textBlockHeight = lines.length * lineHeight;
      const topShadeHeight = padY * 2 + textBlockHeight + 12;

      // Subtle light top fade behind left text only so the rest of the photo stays bright and clear
      const shadeW = logoBoxW > 0 ? width - logoBoxW + 16 : width;
      const topGrad = ctx.createLinearGradient(0, 0, 0, topShadeHeight);
      topGrad.addColorStop(0, "rgba(0, 0, 0, 0.56)");
      topGrad.addColorStop(0.65, "rgba(0, 0, 0, 0.24)");
      topGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, shadeW, topShadeHeight);

      // Draw Top-Left White Text Lines (supporting RTL Arabic lines alongside LTR lines)
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#ffffff";
      lines.forEach((line, idx) => {
        ctx.direction = /[\u0600-\u06FF]/.test(line) ? "rtl" : "ltr";
        ctx.textAlign = "left";
        ctx.fillText(line, padX, padY + idx * lineHeight);
      });
      ctx.restore();

      // 3. Draw Top-Right White Logo Strip Flush to Corner
      if (logosImg && logoBoxW > 0 && logoBoxH > 0) {
        const logoBoxX = width - logoBoxW;
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(logoBoxX, 0, logoBoxW, logoBoxH);
        ctx.drawImage(logosImg, logoBoxX + logoPad, logoPad, logoInnerW, logoInnerH);
        ctx.restore();
      }

      // 4. Draw Bottom-Left Compact Satellite Minimap with Red Pin
      if (location) {
        const mapW = Math.round(width * 0.21);
        const mapH = Math.min(Math.round(mapW * 0.94), Math.round(height * 0.21));
        const mapX = 0;
        const mapY = height - mapH;

        ctx.save();
        ctx.beginPath();
        ctx.rect(mapX, mapY, mapW, mapH);
        ctx.clip();

        if (minimapCanvas && minimapCanvas.width > 0 && minimapCanvas.height > 0) {
          const snapW = minimapCanvas.width;
          const snapH = minimapCanvas.height;
          let srcW = snapW;
          let srcH = snapH;
          if (mapW / mapH >= 1) {
            srcH = Math.round(snapW * (mapH / mapW));
          } else {
            srcW = Math.round(snapH * (mapW / mapH));
          }
          const sx = Math.max(0, Math.round((snapW - srcW) / 2));
          const sy = Math.max(0, Math.round((snapH - srcH) / 2));
          ctx.drawImage(minimapCanvas, sx, sy, srcW, srcH, mapX, mapY, mapW, mapH);
        } else {
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(mapX, mapY, mapW, mapH);
        }

        const pinHeight = Math.max(24, Math.round(mapH * 0.24));
        drawRedMapPin(ctx, mapX + mapW / 2, mapY + mapH / 2, pinHeight);
        ctx.restore();

        // Subtle crisp frame around exposed edges of minimap
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = Math.max(1.5, Math.round(width * 0.002));
        ctx.beginPath();
        ctx.moveTo(mapX, mapY);
        ctx.lineTo(mapX + mapW, mapY);
        ctx.lineTo(mapX + mapW, height);
        ctx.stroke();
        ctx.restore();
      }
    }

    function processPhotoOnCanvas(file, options) {
      const { maxWidth, quality, watermarkInfo } = options;

      return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Image decode failed"));
        };

        img.onload = () => {
          URL.revokeObjectURL(objectUrl);

          let targetWidth = img.naturalWidth || img.width;
          let targetHeight = img.naturalHeight || img.height;

          if (Number.isFinite(maxWidth) && targetWidth > maxWidth) {
            const ratio = maxWidth / targetWidth;
            targetWidth = maxWidth;
            targetHeight = Math.round(targetHeight * ratio);
          }

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          if (watermarkInfo) {
            drawPhotoWatermark(ctx, targetWidth, targetHeight, watermarkInfo);
          }

          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Canvas toBlob failed"));
                return;
              }
              resolve({
                blob,
                dataUrl,
                originalSize: file.size,
                compressedSize: blob.size
              });
            },
            "image/jpeg",
            quality
          );
        };

        img.src = objectUrl;
      });
    }

    function formatBytes(bytes) {
      if (!bytes || bytes < 1024) return `${bytes || 0} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    // --- Offline Outbox Persistence & Sync Engine (Upload All / One-by-One) ---
    function getOutboxItemIdForOid(oid) {
      if (!OfflineDB) return `oid_${oid}`;
      return OfflineDB.makeOutboxId(resolvedPointsServiceUrl || ACTIVE_POINTS_URL, oid);
    }

    async function saveSubmissionToOutbox(feature, attributesPayload, options = {}) {
      if (!OfflineDB) {
        throw new Error("المتصفح لا يدعم التخزين المحلي IndexedDB.");
      }
      const oidField = pointsLayer?.objectIdField || "OBJECTID";
      const oid = feature.attributes?.[oidField];
      const attrs = feature.attributes || {};
      const orderVal = getStopOrderValue(attrs) ?? "--";
      const pointCode = getCleanPointCode(attrs);
      const district = getCleanAttrText(attrs, ACTIVE_FIELDS.district || "district");
      const streetName = getCleanAttrText(attrs, ACTIVE_FIELDS.streetName || "street_name");

      const savedRecord = await OfflineDB.saveOrMergeOutboxItem({
        id: getOutboxItemIdForOid(oid),
        mode: APP_MODE,
        objectId: oid,
        layerUrl: resolvedPointsServiceUrl || ACTIVE_POINTS_URL,
        orderVal,
        pointCode,
        district,
        streetName,
        attributes: attributesPayload,
        photos: [...selectedPhotos],
        deleteAttachmentIds: [...pendingDeleteAttachmentIds],
        replacePhotos: Boolean(options.replacePhotos),
        replaceDeletes: Boolean(options.replaceDeletes),
        skipAttributeEdit: Boolean(options.skipAttributeEdit)
      });

      // Mirror status immediately onto local cached features & offline layer
      Object.assign(feature.attributes, attributesPayload);
      const targetFeature = cachedFeatures.find(
        (f) => f.attributes?.[oidField] === oid
      );
      if (targetFeature && targetFeature !== feature) {
        Object.assign(targetFeature.attributes, attributesPayload);
      }
      if (isOfflineCacheMode && pointsLayer && !pointsLayer.url) {
        const localClone = feature.clone();
        Object.assign(localClone.attributes, attributesPayload);
        await pointsLayer.applyEdits({ updateFeatures: [localClone] }).catch(() => {});
      }

      updateProgressUI(cachedFeatures);
      await refreshOutboxUI();
      return savedRecord;
    }

    function updateOnlineStatusUI() {
      const online = navigator.onLine;
      if (els.offlineBanner) {
        els.offlineBanner.hidden = online;
      }
      if (els.outboxNetBadge) {
        els.outboxNetBadge.textContent = online ? "متصل بالإنترنت" : "غير متصل";
        els.outboxNetBadge.className = `status-badge ${online ? "completed" : "pending"}`;
      }
      if (els.outboxPillBtn) {
        els.outboxPillBtn.classList.toggle("online-ready", online && cachedOutboxItems.length > 0);
      }
      if (els.outboxActionHint) {
        els.outboxActionHint.textContent = online ? "اضغط للرفع" : "بانتظار الشبكة";
      }
      if (els.btnSyncAll && !isSyncingOutbox) {
        els.btnSyncAll.disabled = !online || cachedOutboxItems.length === 0;
      }
    }

    async function refreshOutboxUI() {
      if (!OfflineDB || isDemoMode) {
        cachedOutboxItems = [];
        if (els.outboxPillBtn) els.outboxPillBtn.hidden = true;
        updateOnlineStatusUI();
        return;
      }

      cachedOutboxItems = await getModeOutboxItems();
      const count = cachedOutboxItems.length;

      if (els.outboxPillBtn && els.outboxCountText) {
        els.outboxPillBtn.hidden = count === 0;
        els.outboxCountText.textContent =
          count === 1
            ? "مهمة واحدة بانتظار الرفع"
            : count === 2
              ? "مهمتان بانتظار الرفع"
              : `${count} مهام بانتظار الرفع`;
      }

      updateOnlineStatusUI();
      if (els.outboxSheet?.classList.contains("open")) {
        renderOutboxList();
      }
    }

    function setSyncStatusBanner(text, visible = true) {
      if (!els.outboxSyncStatus) return;
      els.outboxSyncStatus.textContent = text || "";
      els.outboxSyncStatus.hidden = !visible || !text;
    }

    function renderOutboxList() {
      if (!els.outboxList) return;
      els.outboxList.innerHTML = "";

      if (cachedOutboxItems.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "outbox-empty";
        emptyDiv.textContent = "تمت مزامنة جميع النقاط والصور بنجاح ✓";
        els.outboxList.appendChild(emptyDiv);
        if (els.btnSyncAll) els.btnSyncAll.disabled = true;
        return;
      }

      if (els.btnSyncAll && !isSyncingOutbox) {
        els.btnSyncAll.disabled = !navigator.onLine;
      }

      const summaryField = resolveLayerFieldName(
        IS_EXEC_MODE
          ? ACTIVE_FIELDS.stage || "stage"
          : ACTIVE_FIELDS.committeeDecision || "committee_decision"
      );

      cachedOutboxItems.forEach((item) => {
        const card = document.createElement("div");
        card.className = `outbox-card${item.status === "uploading" ? " uploading" : ""}`;

        const head = document.createElement("div");
        head.className = "outbox-card-head";

        const title = document.createElement("div");
        title.className = "outbox-card-title";
        title.textContent = item.pointCode
          ? `محطة #${item.orderVal} (${item.pointCode})`
          : `محطة رقم #${item.orderVal}`;

        const timeEl = document.createElement("div");
        timeEl.className = "outbox-card-time";
        timeEl.textContent = item.updatedAt
          ? formatWatermarkTimestamp(new Date(item.updatedAt))
          : "";

        head.appendChild(title);
        head.appendChild(timeEl);
        card.appendChild(head);

        const meta = document.createElement("div");
        meta.className = "outbox-card-meta";
        const summaryText =
          item.attributes?.[summaryField] ||
          item.attributes?.stage ||
          item.attributes?.committee_decision ||
          "تحديث بيانات";
        const photoCount = Array.isArray(item.photos) ? item.photos.length : 0;
        const delCount = Array.isArray(item.deleteAttachmentIds)
          ? item.deleteAttachmentIds.length
          : 0;
        const parts = [summaryText];
        if (photoCount > 0) parts.push(`📷 ${photoCount} صورة`);
        if (delCount > 0) parts.push(`🗑️ حذف ${delCount}`);
        if (item.district) parts.push(item.district);
        meta.textContent = parts.join(" · ");
        card.appendChild(meta);

        if (item.lastError) {
          const errBox = document.createElement("div");
          errBox.className = "outbox-card-error";
          errBox.textContent = item.lastError;
          card.appendChild(errBox);
        }

        const actions = document.createElement("div");
        actions.className = "outbox-card-actions";

        const uploadBtn = document.createElement("button");
        uploadBtn.type = "button";
        uploadBtn.className = "btn-outbox-upload";
        uploadBtn.disabled = isSyncingOutbox || !navigator.onLine;
        uploadBtn.textContent =
          item.status === "uploading" ? "جاري الرفع..." : "☁️ رفع الآن";
        uploadBtn.addEventListener("click", () => {
          uploadSingleOutboxItem(item.id);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn-outbox-delete";
        deleteBtn.disabled = isSyncingOutbox;
        deleteBtn.textContent = "حذف";
        deleteBtn.addEventListener("click", () => {
          removeOutboxDraft(item.id, title.textContent);
        });

        actions.appendChild(uploadBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);
        els.outboxList.appendChild(card);
      });
    }

    function openOutboxSheet() {
      refreshOutboxUI().then(() => {
        renderOutboxList();
        els.outboxBackdrop?.classList.add("open");
        els.outboxSheet?.classList.add("open");
      });
    }

    function closeOutboxSheet() {
      if (isSyncingOutbox) return;
      els.outboxBackdrop?.classList.remove("open");
      els.outboxSheet?.classList.remove("open");
      setSyncStatusBanner("", false);
    }

    async function ensureLiveSyncReady() {
      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً.");
      }

      const tokenRes = await registerEsriTokenFromServer();
      if (!tokenRes.token && tokenRes.error) {
        throw new Error(`تعذر تجديد توكن ArcGIS: ${tokenRes.error}`);
      }

      if (isOfflineCacheMode || !pointsLayer || !pointsLayer.url) {
        await upgradeOfflineLayerToLive();
      }

      if (!pointsLayer || !pointsLayer.loaded) {
        await pointsLayer.load();
      }
    }

    async function syncOutboxRecord(record, prefixLabel = "") {
      if (!OfflineDB || !record) return;

      const oidField = pointsLayer.objectIdField || "OBJECTID";
      const workingRecord = { ...record, photos: [...(record.photos || [])], status: "uploading", lastError: "" };
      await OfflineDB.putOutboxItem(workingRecord);
      await refreshOutboxUI();

      try {
        // Resolve the real graphic from live layer or build lightweight Graphic with OID
        let baseGraphic = cachedFeatures.find(
          (f) => String(f.attributes?.[oidField]) === String(workingRecord.objectId)
        );
        if (!baseGraphic) {
          baseGraphic = new Graphic({
            attributes: { [oidField]: workingRecord.objectId }
          });
        }

        const updatedGraphic = baseGraphic.clone();
        updatedGraphic.attributes[oidField] = workingRecord.objectId;

        Object.entries(workingRecord.attributes || {}).forEach(([k, v]) => {
          const resolvedKey = resolveLayerFieldName(k);
          updatedGraphic.attributes[resolvedKey] = v;
        });

        if (!workingRecord.skipAttributeEdit) {
          setSyncStatusBanner(`${prefixLabel}جاري رفع البيانات النصية...`, true);
          const editRes = await pointsLayer.applyEdits({
            updateFeatures: [updatedGraphic]
          });
          const featureRes = editRes?.updateFeatureResults?.[0];
          if (featureRes?.error) {
            throw new Error(featureRes.error.message || "فشل تحديث بيانات النقطة.");
          }
          workingRecord.skipAttributeEdit = true;
          await OfflineDB.putOutboxItem(workingRecord);
        }

        if (
          Array.isArray(workingRecord.deleteAttachmentIds) &&
          workingRecord.deleteAttachmentIds.length > 0
        ) {
          setSyncStatusBanner(`${prefixLabel}جاري حذف الصور المحددة...`, true);
          const delRes = await pointsLayer.deleteAttachments(
            updatedGraphic,
            workingRecord.deleteAttachmentIds
          );
          if (delRes?.error) {
            throw new Error(delRes.error.message || "فشل حذف إحدى الصور.");
          }
          if (Array.isArray(delRes?.deleteAttachmentResults)) {
            const failedDel = delRes.deleteAttachmentResults.find(
              (r) => r?.error || r?.success === false
            );
            if (failedDel) {
              throw new Error(failedDel.error?.message || "فشل حذف إحدى الصور.");
            }
          }
          workingRecord.deleteAttachmentIds = [];
          await OfflineDB.putOutboxItem(workingRecord);
        }

        const totalPhotos = workingRecord.photos.length;
        for (let i = 0; i < totalPhotos; i++) {
          const p = workingRecord.photos[0];
          setSyncStatusBanner(
            `${prefixLabel}جاري رفع صورة ${i + 1} من ${totalPhotos}...`,
            true
          );

          const blob = new Blob([p.buffer], { type: p.type || "image/jpeg" });
          const formData = new FormData();
          formData.append("attachment", blob, p.filename || `field_photo_${i + 1}.jpg`);

          const attachRes = await pointsLayer.addAttachment(updatedGraphic, formData);
          if (attachRes?.error) {
            throw new Error(attachRes.error.message || `فشل رفع صورة ${i + 1}.`);
          }

          // Remove uploaded photo immediately so partial uploads never duplicate
          workingRecord.photos.shift();
          await OfflineDB.putOutboxItem(workingRecord);
        }

        await OfflineDB.deleteOutboxItem(workingRecord.id);
      } catch (err) {
        workingRecord.status = "error";
        workingRecord.lastError = err?.message || "تعذر الرفع للخادم.";
        await OfflineDB.putOutboxItem(workingRecord);
        throw err;
      }
    }

    function setOutboxSyncingState(syncing) {
      isSyncingOutbox = syncing;
      if (els.btnSyncAll) {
        els.btnSyncAll.disabled = syncing || !navigator.onLine || cachedOutboxItems.length === 0;
      }
      if (els.syncAllSpinner) {
        els.syncAllSpinner.classList.toggle("visible", syncing);
      }
      if (els.syncAllBtnText) {
        els.syncAllBtnText.textContent = syncing
          ? "جاري المزامنة..."
          : "☁️ رفع الكل مرة واحدة";
      }
      if (els.btnCloseOutbox) {
        els.btnCloseOutbox.disabled = syncing;
      }
      renderOutboxList();
    }

    async function uploadSingleOutboxItem(itemId) {
      if (isSyncingOutbox || !OfflineDB) return;
      const item = await OfflineDB.getOutboxItem(itemId).catch(() => null);
      if (!item) return;

      setOutboxSyncingState(true);
      try {
        setSyncStatusBanner("جاري تجهيز الاتصال وتجديد التوكن...", true);
        await ensureLiveSyncReady();
        const label = item.pointCode ? `${item.pointCode}: ` : `#${item.orderVal}: `;
        await syncOutboxRecord(item, label);

        pointsLayer.refresh();
        await loadAndSyncPoints(false);
        setSyncStatusBanner("تم رفع النقطة بنجاح ✓", true);
        showToast("تم رفع النقطة بنجاح", "success");
      } catch (err) {
        console.error("Single outbox upload error:", err);
        setSyncStatusBanner(err?.message || "تعذر رفع النقطة.", true);
        showToast(err?.message || "تعذر رفع النقطة حالياً.", "error", 4500);
      } finally {
        setOutboxSyncingState(false);
        await refreshOutboxUI();
      }
    }

    async function uploadAllOutboxItems() {
      if (isSyncingOutbox || !OfflineDB) return;
      const queue = await getModeOutboxItems();
      if (queue.length === 0) return;

      setOutboxSyncingState(true);
      let uploadedCount = 0;

      try {
        setSyncStatusBanner("جاري تجهيز الاتصال وتجديد التوكن...", true);
        await ensureLiveSyncReady();

        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          const prefix = `(${i + 1} من ${queue.length}) `;
          await syncOutboxRecord(item, prefix);
          uploadedCount++;
        }

        pointsLayer.refresh();
        await loadAndSyncPoints(false);
        setSyncStatusBanner(`تم رفع ${uploadedCount} مهام بنجاح ✓`, true);
        showToast(`تم رفع جميع المهام (${uploadedCount}) بنجاح`, "success", 4000);
      } catch (err) {
        console.error("Batch outbox sync error:", err);
        if (uploadedCount > 0 && pointsLayer) {
          pointsLayer.refresh();
          await loadAndSyncPoints(false).catch(() => {});
        }
        setSyncStatusBanner(
          `توقف الرفع بعد ${uploadedCount} من ${queue.length}: ${err?.message || "خطأ بالاتصال"}`,
          true
        );
        showToast(
          `تم رفع ${uploadedCount} وتبقت مهام لم تُرفع بسبب الشبكة.`,
          "error",
          5000
        );
      } finally {
        setOutboxSyncingState(false);
        await refreshOutboxUI();
      }
    }

    async function removeOutboxDraft(itemId, label) {
      if (isSyncingOutbox || !OfflineDB) return;
      if (!window.confirm(`هل تريد حذف المسودة المحلية (${label}) نهائياً؟`)) {
        return;
      }
      await OfflineDB.deleteOutboxItem(itemId);
      await loadAndSyncPoints(false).catch(() => {});
      await refreshOutboxUI();
      showToast("تم حذف المسودة المحلية", "info");
    }

    if (els.outboxPillBtn) {
      els.outboxPillBtn.addEventListener("click", openOutboxSheet);
    }
    if (els.btnCloseOutbox) {
      els.btnCloseOutbox.addEventListener("click", closeOutboxSheet);
    }
    if (els.outboxBackdrop) {
      els.outboxBackdrop.addEventListener("click", closeOutboxSheet);
    }
    if (els.btnSyncAll) {
      els.btnSyncAll.addEventListener("click", uploadAllOutboxItems);
    }

    // --- Form Submission (applyEdits + Sequential Multi-Attachment Upload + Offline Outbox Fallback) ---
    els.pointForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeFeature || !pointsLayer) return;

      hideFormError();

      const oidField = pointsLayer.objectIdField || "OBJECTID";
      const oid = activeFeature.attributes[oidField];
      const dateField = resolveLayerFieldName(
        ACTIVE_FIELDS.actualHandoverDate || "actual_handover_date"
      );
      const statusField = activeStatusField || ACTIVE_FIELDS.status || "status";

      let attributesPayload;

      if (IS_EXEC_MODE) {
        const execStage = els.fieldExecStage?.value || "";
        const execNotes = (els.fieldExecNotes?.value || "").trim();

        if (!execStage) {
          showFormError("يرجى اختيار مرحلة التنفيذ.");
          els.fieldExecStage?.focus();
          return;
        }

        const stageField = resolveLayerFieldName(ACTIVE_FIELDS.stage || "stage");
        const notesField = resolveLayerFieldName(ACTIVE_FIELDS.notes || "notes");

        attributesPayload = {
          [dateField]: Date.now(),
          [stageField]: execStage,
          [notesField]: execNotes,
          [statusField]: STATUS_VALUES.completed
        };
      } else {
        const committeeDecision = els.fieldCommitteeDecision?.value || "";
        const hasBase = els.fieldHasBase?.value || "";
        const notesObstacles = (els.fieldNotesObstacles?.value || "").trim();

        if (!committeeDecision) {
          showFormError("يرجى اختيار قرار لجنة التسليم.");
          els.fieldCommitteeDecision?.focus();
          return;
        }

        if (!hasBase) {
          showFormError("يرجى تحديد ما إذا كان يوجد قاعدة بالموقع أم لا.");
          els.fieldHasBase?.focus();
          return;
        }

        if (DECISIONS_REQUIRING_NOTES.has(committeeDecision) && !notesObstacles) {
          showFormError("يرجى إدخال الملاحظات / المعوقات لأن قرار اللجنة يتطلب توضيحها.");
          els.fieldNotesObstacles?.focus();
          return;
        }

        const decisionField = resolveLayerFieldName(
          ACTIVE_FIELDS.committeeDecision || "committee_decision"
        );
        const hasBaseField = resolveLayerFieldName(ACTIVE_FIELDS.hasBase || "has_base");
        const notesField = resolveLayerFieldName(
          ACTIVE_FIELDS.notesObstacles || "notes_obstacles"
        );

        attributesPayload = {
          [dateField]: Date.now(),
          [decisionField]: committeeDecision,
          [hasBaseField]: hasBase,
          [notesField]: notesObstacles,
          [statusField]: STATUS_VALUES.completed
        };
      }

      const wasAlreadyCompleted = isCompletedStatus(
        getStopStatusValue(activeFeature.attributes)
      );
      setSubmittingState(true, "جاري حفظ البيانات...");

      // If completely offline (or running from cached layer), queue straight to IndexedDB Outbox
      if (!isDemoMode && (isOfflineCacheMode || !navigator.onLine)) {
        try {
          await saveSubmissionToOutbox(activeFeature, attributesPayload, {
            replacePhotos: openedWithOutboxDraft,
            replaceDeletes: openedWithOutboxDraft,
            skipAttributeEdit: false
          });
          const savedPhotosCount = selectedPhotos.length;
          closeBottomSheet();
          showToast(
            savedPhotosCount > 0
              ? `📡 تم الحفظ محلياً بدون نت (${savedPhotosCount} صور) وسيُرفع لاحقاً`
              : "📡 تم حفظ التعديلات محلياً بدون نت وستُرفع لاحقاً",
            "info",
            4500
          );
        } catch (offlineErr) {
          console.error("Offline save error:", offlineErr);
          showFormError(offlineErr?.message || "تعذر حفظ البيانات محلياً على الجهاز.");
        } finally {
          setSubmittingState(
            false,
            wasAlreadyCompleted ? "حفظ التعديلات" : "حفظ وإتمام النقطة"
          );
        }
        return;
      }

      let attributesSavedOnServer = false;

      try {
        const updatedGraphic = activeFeature.clone();
        updatedGraphic.attributes[oidField] = oid;
        Object.assign(updatedGraphic.attributes, attributesPayload);

        const editResult = await pointsLayer.applyEdits({
          updateFeatures: [updatedGraphic]
        });

        const featureUpdateRes = editResult?.updateFeatureResults?.[0];
        if (featureUpdateRes?.error) {
          throw new Error(
            featureUpdateRes.error.message || "فشل تحديث بيانات النقطة في الخادم."
          );
        }
        attributesSavedOnServer = true;

        // Delete any existing attachments marked for removal
        if (!isDemoMode && pendingDeleteAttachmentIds.length > 0) {
          setSubmittingState(true, "جاري حذف الصور المحددة...");
          const delRes = await pointsLayer.deleteAttachments(
            updatedGraphic,
            pendingDeleteAttachmentIds
          );
          if (delRes?.error) {
            throw new Error(
              delRes.error.message || "فشل حذف إحدى الصور المرفقة من الخادم."
            );
          }
          if (Array.isArray(delRes?.deleteAttachmentResults)) {
            const failedDel = delRes.deleteAttachmentResults.find(
              (r) => r?.error || r?.success === false
            );
            if (failedDel) {
              throw new Error(
                failedDel.error?.message || "فشل حذف إحدى الصور المرفقة من الخادم."
              );
            }
          }
          pendingDeleteAttachmentIds = [];
        }

        // Upload all queued photos sequentially
        const photosQueue = [...selectedPhotos];
        const totalPhotos = photosQueue.length;

        for (let i = 0; i < totalPhotos; i++) {
          const photo = photosQueue[i];
          setSubmittingState(
            true,
            `جاري رفع صورة ${i + 1} من ${totalPhotos}...`
          );

          if (isDemoMode) {
            await new Promise((r) => setTimeout(r, 350));
          } else {
            const formData = new FormData();
            formData.append("attachment", photo.blob, photo.filename);

            const attachRes = await pointsLayer.addAttachment(updatedGraphic, formData);
            if (attachRes?.error) {
              throw new Error(
                attachRes.error.message ||
                  `تم حفظ البيانات ولكن فشل رفع الصورة رقم ${i + 1}.`
              );
            }
          }

          // Remove uploaded photo from queue so retries won't duplicate it
          removeQueuedPhoto(photo.id);
        }

        if (!isDemoMode && OfflineDB) {
          await OfflineDB.deleteOutboxItem(getOutboxItemIdForOid(oid)).catch(() => {});
        }

        if (!isDemoMode) {
          pointsLayer.refresh();
        }
        await loadAndSyncPoints(false);

        closeBottomSheet();
        showToast(
          wasAlreadyCompleted ? "تم حفظ تعديلات النقطة بنجاح" : "تم حفظ وإتمام النقطة بنجاح",
          "success"
        );
      } catch (err) {
        console.error("Submission error:", err);

        // Automatic fallback to IndexedDB Outbox if network dropped before or during upload
        if (!isDemoMode && isLikelyNetworkError(err)) {
          try {
            await saveSubmissionToOutbox(activeFeature, attributesPayload, {
              replacePhotos: openedWithOutboxDraft || attributesSavedOnServer,
              replaceDeletes: openedWithOutboxDraft || attributesSavedOnServer,
              skipAttributeEdit: attributesSavedOnServer
            });
            const remCount = selectedPhotos.length;
            closeBottomSheet();
            showToast(
              remCount > 0
                ? `📶 انقطع الاتصال — تم حفظ المتبقي (${remCount} صور) للرفع عند عودة النت`
                : "📶 انقطع الاتصال — تم حفظ النقطة محلياً للرفع عند عودة النت",
              "info",
              5000
            );
            return;
          } catch (fallbackErr) {
            console.error("Fallback offline save error:", fallbackErr);
          }
        }

        showFormError(
          err?.message
            ? `تعذر الحفظ: ${err.message}`
            : "حدث خطأ أثناء الاتصال بالخادم. تحقق من شبكة الجوال وحاول مرة أخرى."
        );
      } finally {
        setSubmittingState(
          false,
          wasAlreadyCompleted ? "حفظ التعديلات" : "حفظ وإتمام النقطة"
        );
      }
    });

    function setSubmittingState(isSubmitting, buttonText) {
      els.btnSubmitForm.disabled = isSubmitting;
      els.submitSpinner.classList.toggle("visible", isSubmitting);
      els.submitBtnText.textContent = buttonText;
    }

    function showFormError(message) {
      els.formError.textContent = message;
      els.formError.classList.add("visible");
    }

    function hideFormError() {
      els.formError.textContent = "";
      els.formError.classList.remove("visible");
    }

    function showToast(message, type = "info", durationMs = 3000) {
      if (toastTimer) clearTimeout(toastTimer);
      els.toast.textContent = message;
      els.toast.className = `toast show ${type}`;
      toastTimer = setTimeout(() => {
        els.toast.classList.remove("show");
      }, durationMs);
    }

    // --- Network State Listeners & Service Worker Registration ---
    window.addEventListener("online", async () => {
      updateOnlineStatusUI();
      await refreshOutboxUI();

      if (cachedOutboxItems.length > 0) {
        showToast(
          `🌐 عاد الاتصال بالإنترنت — لديك ${cachedOutboxItems.length} مهام جاهزة للرفع`,
          "success",
          5000
        );
      } else {
        showToast("🌐 عاد الاتصال بالإنترنت", "info", 2500);
      }

      if (isOfflineCacheMode && ACTIVE_POINTS_URL && ACTIVE_POINTS_URL.trim() !== "") {
        upgradeOfflineLayerToLive().catch(() => {});
      }
    });

    window.addEventListener("offline", () => {
      updateOnlineStatusUI();
      showToast("📡 انقطع الاتصال بالإنترنت — سيستمر الحفظ محلياً", "info", 3500);
    });

    if (!IS_LOCAL_FILE && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("Service worker registration skipped:", err);
      });
    }

    // --- Startup Check ---
    loadWatermarkLogos().catch(() => {});
    refreshOutboxUI().catch(() => {});
    const isDemoRequested = new URLSearchParams(location.search).get("demo") === "1";

    if (ACTIVE_POINTS_URL && ACTIVE_POINTS_URL.trim() !== "") {
      initializeLayers(false);
    } else if (isDemoRequested && els.setupModal) {
      els.setupModal.hidden = false;
      els.progressText.textContent = "بانتظار إعداد رابط الطبقة";

      els.btnStartDemo.addEventListener("click", () => {
        els.setupModal.hidden = true;
        initializeLayers(true);
      });
    } else {
      // Clear stale offline layer cache when this mode is intentionally empty (no points)
      if (OfflineDB?.deleteLayerCache) {
        OfflineDB.deleteLayerCache(POINTS_CACHE_KEY).catch(() => {});
        OfflineDB.deleteLayerCache(ROUTE_CACHE_KEY).catch(() => {});
        if (!IS_EXEC_MODE) {
          OfflineDB.deleteLayerCache("points_cache").catch(() => {});
          OfflineDB.deleteLayerCache("route_cache").catch(() => {});
        }
      }
      els.progressText.textContent = IS_EXEC_MODE
        ? "لا توجد نقاط تنفيذ متاحة حالياً"
        : "لا توجد نقاط استلام متاحة حالياً";
      els.progressPercent.textContent = "0%";
      els.progressFill.style.width = "0%";
      updateOnlineStatusUI();
    }
  });
})();
