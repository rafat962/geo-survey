/* =========================================================================
 * FIELD DATA COLLECTION & ROUTE NAVIGATION APP
 * ========================================================================= */

(function () {
  const IS_LOCAL_FILE = location.protocol === "file:";
  const LOCAL_AUTH_KEY = "fieldAppLocalAuth";

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
        window.location.replace("/");
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
        window.location.replace("/");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated && data.user && userBadge) {
          userBadge.textContent = data.user;
          userBadge.hidden = false;
        } else if (!data?.authenticated) {
          window.location.replace("/");
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
      nextBanner: document.getElementById("nextBanner"),
      nextHeaderRow: document.getElementById("nextHeaderRow"),
      nextTitle: document.getElementById("nextTitle"),
      nextSubtitle: document.getElementById("nextSubtitle"),
      btnZoomNext: document.getElementById("btnZoomNext"),
      nextActionsRow: document.getElementById("nextActionsRow"),
      btnOpenNextForm: document.getElementById("btnOpenNextForm"),
      btnGoogleMaps: document.getElementById("btnGoogleMaps"),
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
      existingPhotosSection: document.getElementById("existingPhotosSection"),
      existingPhotosList: document.getElementById("existingPhotosList"),
      photoInput: document.getElementById("photoInput"),
      btnPickPhoto: document.getElementById("btnPickPhoto"),
      photoCountLabel: document.getElementById("photoCountLabel"),
      photoGallery: document.getElementById("photoGallery"),
      formError: document.getElementById("formError"),
      btnSubmitForm: document.getElementById("btnSubmitForm"),
      submitSpinner: document.getElementById("submitSpinner"),
      submitBtnText: document.getElementById("submitBtnText")
    };

    // --- State ---
    let pointsLayer = null;
    let routeLayer = null;
    let activeSegmentLayer = new GraphicsLayer({ id: "active-next-segment" });
    let highlightLayer = new GraphicsLayer({ id: "next-point-highlight" });
    let activeOrderField = FIELDS.order || "Sequence";
    let activeStatusField = FIELDS.status || "status";
    let cachedFeatures = [];
    let nextPendingFeature = null;
    let activeFeature = null;
    let selectedPhotos = [];
    let photoIdCounter = 0;
    let isDemoMode = false;
    let pulseIntervalId = null;
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
        top: 150,
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

    // Re-draw active GPS -> Next Stop segment & distance as the field worker moves
    reactiveUtils.watch(
      () => track.graphic?.geometry,
      () => {
        if (nextPendingFeature) {
          updateNextStopDistanceAndSegment();
        }
      }
    );

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

    function createNumberedLabeling(
      orderFieldName = activeOrderField,
      statusFieldName = activeStatusField
    ) {
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
          window.location.replace("/");
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
          ...getServiceServers(POINTS_LAYER_URL),
          ...getServiceServers(ROUTE_LAYER_URL)
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
        return FIELDS.order || "Sequence";
      }
      const candidates = [
        FIELDS.order || "Sequence",
        FIELDS.orderFallback || "order_num",
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
      return oidField ? oidField.name : FIELDS.order || "Sequence";
    }

    function resolveStatusFieldName(fields) {
      if (!Array.isArray(fields) || fields.length === 0) return null;
      const target = (FIELDS.status || "status").toLowerCase();
      const match = fields.find((f) => f.name?.toLowerCase() === target);
      return match ? match.name : null;
    }

    function getStopStatusValue(attrs) {
      if (!attrs) return null;
      const candidates = [activeStatusField, FIELDS.status, "status"].filter(Boolean);
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
        FIELDS.order,
        FIELDS.orderFallback,
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
          return configuredLayerId !== null ? cleanUrl : `${serviceRoot}/0`;
        }
        const info = await res.json().catch(() => null);
        if (info?.error) {
          console.warn("ArcGIS service metadata error:", serviceRoot, info.error);
          return configuredLayerId !== null ? cleanUrl : `${serviceRoot}/0`;
        }

        const layers = Array.isArray(info?.layers) ? info.layers : [];
        if (layers.length === 0) {
          return configuredLayerId !== null ? cleanUrl : `${serviceRoot}/0`;
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

        const existingConfigured =
          configuredLayerId !== null
            ? detailedLayers.find((l) => Number(l.id) === configuredLayerId)
            : null;
        return (existingConfigured || detailedLayers[0]).url;
      } catch (err) {
        console.warn("Service metadata inspection skipped for", cleanUrl, err);
        return configuredLayerId !== null ? cleanUrl : `${serviceRoot}/0`;
      }
    }

    async function initializeLayers(useDemo) {
      isDemoMode = useDemo;
      els.demoBadge.classList.toggle("visible", useDemo);

      let tokenError = null;
      let accessToken = null;
      if (!useDemo) {
        const tokenRes = await registerEsriTokenFromServer();
        accessToken = tokenRes.token;
        tokenError = tokenRes.error;
        if (tokenError) {
          showToast(`تعذر توليد توكن ArcGIS: ${tokenError}`, "error", 6500);
        }
      }

      const [resolvedRouteUrl, resolvedPointsUrl] = useDemo
        ? [ROUTE_LAYER_URL, POINTS_LAYER_URL]
        : await Promise.all([
            resolveFeatureLayerUrl(ROUTE_LAYER_URL, accessToken, "esriGeometryPolyline"),
            resolveFeatureLayerUrl(POINTS_LAYER_URL, accessToken, "esriGeometryPoint")
          ]);

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
      } else {
        routeLayer = new GraphicsLayer({ id: "auto-route-layer", opacity: 0.8 });
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

      map.addMany([routeLayer, activeSegmentLayer, highlightLayer, pointsLayer]);

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
            }
          })
          .catch((err) => {
            console.error("Failed to load route layer:", err);
            showToast(
              `تعذر تحميل طبقة المسار: ${err?.message || "تحقق من الرابط أو الصلاحيات"}`,
              "error",
              6500
            );
          });
      }

      pointsLayer
        .load()
        .then(() => {
          console.info(
            "Points layer fields:",
            (pointsLayer.fields || []).map((f) => f.name)
          );
          activeOrderField = resolveOrderFieldName(pointsLayer.fields);
          activeStatusField = resolveStatusFieldName(pointsLayer.fields);
          pointsLayer.renderer = createPointsRenderer(activeStatusField);
          pointsLayer.labelingInfo = createNumberedLabeling(activeOrderField, activeStatusField);
          if (activeStatusField) {
            pointsLayer.orderBy = [{ field: activeStatusField, order: "ascending" }];
          }
          return loadAndSyncPoints(true);
        })
        .catch((err) => {
          console.error("Failed to load points layer:", err);
          const reason = tokenError
            ? `مشكلة توكن ArcGIS: ${tokenError}`
            : err?.message || "تأكد من رابط الطبقة وصلاحيات الوصول";
          els.progressText.textContent = "تعذر تحميل طبقة النقاط";
          els.nextTitle.textContent = "خطأ في تحميل الطبقة";
          els.nextSubtitle.textContent = reason;
          showToast(`فشل تحميل طبقة النقاط: ${reason}`, "error", 7000);
        });
    }

    function createDemoFeatureLayer() {
      const baseLat = 24.7136;
      const baseLng = 46.6753;
      const nowMs = Date.now();
      const samplePoints = [
        {
          name: "1. UN-009",
          order: 1,
          status: STATUS_VALUES.completed,
          date: nowMs - 86400000,
          decision: "استلام الموقع",
          hasBase: "نعم",
          notes: "تم الاستلام والموقع جاهز"
        },
        {
          name: "2. MG-095",
          order: 2,
          status: STATUS_VALUES.completed,
          date: nowMs - 86400000,
          decision: "استلام الموقع مع ملاحظات",
          hasBase: "نعم",
          notes: "يحتاج تسوية بسيطة بالرصيف"
        },
        { name: "3. UN-080", order: 3, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "4. UN-040", order: 4, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "5. MG-092", order: 5, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" },
        { name: "6. MG-116", order: 6, status: STATUS_VALUES.pending, date: null, decision: "", hasBase: "", notes: "" }
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
            [FIELDS.name || "Name"]: pt.name,
            [FIELDS.order]: pt.order,
            [FIELDS.status]: pt.status,
            [FIELDS.actualHandoverDate]: pt.date,
            [FIELDS.committeeDecision]: pt.decision,
            [FIELDS.hasBase]: pt.hasBase,
            [FIELDS.notesObstacles]: pt.notes
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
          { name: FIELDS.name || "Name", alias: "Name", type: "string", length: 100, editable: false },
          { name: FIELDS.order, alias: "رقم المحطة", type: "integer", editable: false },
          { name: FIELDS.status, alias: "الحالة", type: "string", editable: true },
          { name: FIELDS.actualHandoverDate, alias: "تاريخ الاستلام الفعلي", type: "date", editable: true },
          { name: FIELDS.committeeDecision, alias: "قرار لجنة التسليم", type: "string", length: 150, editable: true },
          { name: FIELDS.hasBase, alias: "يوجد قاعدة بالموقع", type: "string", length: 20, editable: true },
          { name: FIELDS.notesObstacles, alias: "الملاحظات / المعوقات", type: "string", length: 500, editable: true }
        ],
        popupEnabled: false,
        renderer: createPointsRenderer(),
        labelingInfo: createNumberedLabeling(FIELDS.order),
        orderBy: [{ field: FIELDS.status, order: "ascending" }]
      });
    }

    // --- Query, Route Generation, Progress & Next Point ---
    async function loadAndSyncPoints(shouldZoomAll = false) {
      if (!pointsLayer) return;

      const query = pointsLayer.createQuery();
      query.where = "1=1";
      query.outFields = ["*"];
      query.returnGeometry = true;
      query.outSpatialReference = view.spatialReference;

      const featureSet = await pointsLayer.queryFeatures(query);
      cachedFeatures = sortFeaturesByOrder(featureSet.features || []);

      updateProgressUI(cachedFeatures);
      updateNextPendingPoint(cachedFeatures);

      if (!ROUTE_LAYER_URL || ROUTE_LAYER_URL.trim() === "") {
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

    function calcDistanceMeters(fromCoords, toCoords) {
      if (!fromCoords || !toCoords) return null;
      const R = 6371000;
      const toRad = (deg) => (deg * Math.PI) / 180;
      const dLat = toRad(toCoords.lat - fromCoords.lat);
      const dLon = toRad(toCoords.lng - fromCoords.lng);
      const lat1 = toRad(fromCoords.lat);
      const lat2 = toRad(toCoords.lat);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    function formatDistanceArabic(meters) {
      if (meters === null || !Number.isFinite(meters)) return null;
      if (meters < 1000) return `${Math.round(meters)} متر`;
      return `${(meters / 1000).toFixed(2)} كم`;
    }

    function getLastCompletedFeature(sortedFeatures) {
      const completedList = sortedFeatures.filter((f) =>
        isCompletedStatus(getStopStatusValue(f.attributes))
      );
      return completedList.length > 0
        ? completedList[completedList.length - 1]
        : null;
    }

    function updateNextStopDistanceAndSegment() {
      activeSegmentLayer.removeAll();
      if (!nextPendingFeature || !nextPendingFeature.geometry) return;

      const targetCoords = extractLatLng(nextPendingFeature.geometry);
      const gpsCoords = extractLatLng(track?.graphic?.geometry);

      if (gpsCoords && targetCoords) {
        const distLabel = formatDistanceArabic(
          calcDistanceMeters(gpsCoords, targetCoords)
        );
        els.nextSubtitle.textContent = `المسافة من موقعك: ${distLabel}`;
      } else {
        els.nextSubtitle.textContent = "اضغط لفتح البيانات أو التوجيه عبر خرائط جوجل";
      }

      // Real ArcGIS street route is already on the map; only draw straight fallback segment if no ROUTE_LAYER_URL is configured
      if (ROUTE_LAYER_URL && ROUTE_LAYER_URL.trim() !== "") return;

      // Draw active line from live GPS (or last completed stop) to Next Pending Stop when no route layer exists
      const lastCompleted = getLastCompletedFeature(cachedFeatures);
      const originCoords = gpsCoords || extractLatLng(lastCompleted?.geometry);

      if (originCoords && targetCoords) {
        const segmentLine = new Polyline({
          paths: [
            [
              [originCoords.lng, originCoords.lat],
              [targetCoords.lng, targetCoords.lat]
            ]
          ],
          spatialReference: { wkid: 4326 }
        });

        activeSegmentLayer.add(
          new Graphic({
            geometry: segmentLine,
            symbol: new SimpleLineSymbol({
              color: [14, 165, 233, 0.95],
              width: 6,
              style: "solid",
              cap: "round",
              join: "round"
            })
          })
        );
      }
    }

    function updateNextPendingPoint(sortedFeatures) {
      if (!sortedFeatures || sortedFeatures.length === 0) {
        nextPendingFeature = null;
        els.nextBanner.classList.remove("all-done");
        els.nextTitle.textContent = "لا توجد نقاط في الطبقة";
        els.nextSubtitle.textContent = "تحقق من بيانات طبقة النقاط أو الصلاحيات";
        els.btnZoomNext.hidden = true;
        els.nextActionsRow.hidden = true;
        activeSegmentLayer.removeAll();
        clearNextPointHalo();
        return;
      }

      nextPendingFeature =
        sortedFeatures.find((f) => !isCompletedStatus(getStopStatusValue(f.attributes))) || null;

      if (!nextPendingFeature) {
        els.nextBanner.classList.add("all-done");
        els.nextTitle.textContent = "تم إنجاز جميع المحطات بنجاح!";
        els.nextSubtitle.textContent = "لا توجد محطات متبقية في المسار";
        els.btnZoomNext.hidden = true;
        els.nextActionsRow.hidden = true;
        activeSegmentLayer.removeAll();
        clearNextPointHalo();
        return;
      }

      const orderNum = getStopOrderValue(nextPendingFeature.attributes) ?? "--";
      els.nextBanner.classList.remove("all-done");
      els.nextTitle.textContent = `المحطة التالية: رقم #${orderNum}`;
      els.btnZoomNext.hidden = false;
      els.nextActionsRow.hidden = false;

      const targetCoords = extractLatLng(nextPendingFeature.geometry);
      if (targetCoords) {
        els.btnGoogleMaps.href = `https://www.google.com/maps/dir/?api=1&destination=${targetCoords.lat},${targetCoords.lng}`;
      } else {
        els.btnGoogleMaps.href = "#";
      }

      updateNextStopDistanceAndSegment();
      renderPulsingHalo(nextPendingFeature.geometry);
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

    function clearNextPointHalo() {
      if (pulseIntervalId) {
        clearInterval(pulseIntervalId);
        pulseIntervalId = null;
      }
      highlightLayer.removeAll();
    }

    function renderPulsingHalo(geometry) {
      clearNextPointHalo();
      if (!geometry) return;

      const outerRing = new Graphic({
        geometry: geometry,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [251, 146, 60, 0.22],
          size: "50px",
          outline: {
            color: [249, 115, 22, 0.95],
            width: 3
          }
        })
      });

      const pulseRing = new Graphic({
        geometry: geometry,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [251, 146, 60, 0],
          size: "38px",
          outline: {
            color: [249, 115, 22, 0.9],
            width: 3
          }
        })
      });

      highlightLayer.addMany([outerRing, pulseRing]);

      let step = 0;
      pulseIntervalId = setInterval(() => {
        step = (step + 1) % 30;
        const progress = step / 30;
        const sizePx = 34 + progress * 34;
        const alpha = Math.max(0, 0.95 * (1 - progress));

        pulseRing.symbol = new SimpleMarkerSymbol({
          style: "circle",
          color: [251, 146, 60, 0],
          size: `${sizePx.toFixed(1)}px`,
          outline: {
            color: [249, 115, 22, alpha],
            width: 3
          }
        });
      }, 55);
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

    function zoomToNextPendingStop() {
      if (!nextPendingFeature || !nextPendingFeature.geometry) return;
      view
        .goTo(
          { target: nextPendingFeature.geometry, zoom: Math.max(view.zoom, 17) },
          { duration: 700 }
        )
        .catch(() => {});
    }

    // --- Map Interactions & Floating Buttons ---
    els.btnZoomNext.addEventListener("click", zoomToNextPendingStop);
    els.nextHeaderRow.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      zoomToNextPendingStop();
    });

    els.btnOpenNextForm.addEventListener("click", () => {
      if (!nextPendingFeature) return;
      openBottomSheet(nextPendingFeature);
    });

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
      const decision = els.fieldCommitteeDecision.value;
      const needsNotes = DECISIONS_REQUIRING_NOTES.has(decision);
      els.fieldNotesObstacles.required = needsNotes;
      els.notesRequiredBadge.hidden = !needsNotes;
    }

    els.fieldCommitteeDecision.addEventListener("change", syncNotesRequirement);

    function openBottomSheet(graphic) {
      const oidField = pointsLayer.objectIdField || "OBJECTID";
      const oid = graphic.attributes?.[oidField];
      const fullGraphic =
        cachedFeatures.find((f) => f.attributes?.[oidField] === oid) || graphic;

      activeFeature = fullGraphic;
      resetPhotoState();
      hideFormError();

      const attrs = fullGraphic.attributes || {};
      const orderVal = getStopOrderValue(attrs) ?? "--";
      const pointCode = getCleanPointCode(attrs);
      const completed = isCompletedStatus(getStopStatusValue(attrs));

      els.sheetTitle.textContent = pointCode
        ? `محطة #${orderVal} (${pointCode})`
        : `محطة رقم #${orderVal}`;
      els.sheetStatusBadge.textContent = completed ? "مكتملة" : "قيد الانتظار";
      els.sheetStatusBadge.className = `status-badge ${completed ? "completed" : "pending"}`;

      if (els.btnSheetGoogleMaps) {
        const pointCoords = extractLatLng(fullGraphic.geometry || graphic.geometry);
        if (pointCoords) {
          els.btnSheetGoogleMaps.href = `https://www.google.com/maps/dir/?api=1&destination=${pointCoords.lat},${pointCoords.lng}`;
          els.btnSheetGoogleMaps.hidden = false;
        } else {
          els.btnSheetGoogleMaps.href = "#";
          els.btnSheetGoogleMaps.hidden = true;
        }
      }

      populateFixedFormFields(attrs);
      loadExistingAttachments(oid);

      els.sheetBackdrop.classList.add("open");
      els.bottomSheet.classList.add("open");
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

    function populateFixedFormFields(attrs) {
      const decisionField = FIELDS.committeeDecision || "committee_decision";
      const hasBaseField = FIELDS.hasBase || "has_base";
      const notesField = FIELDS.notesObstacles || "notes_obstacles";

      const savedDecision = attrs[decisionField];
      els.fieldCommitteeDecision.value = savedDecision ? String(savedDecision) : "";

      const savedHasBase = attrs[hasBaseField];
      els.fieldHasBase.value = savedHasBase ? String(savedHasBase) : "";

      els.fieldNotesObstacles.value = attrs[notesField] ?? "";
      syncNotesRequirement();
    }

    async function loadExistingAttachments(objectId) {
      els.existingPhotosSection.hidden = true;
      els.existingPhotosList.innerHTML = "";

      if (
        isDemoMode ||
        !objectId ||
        !pointsLayer?.capabilities?.data?.supportsAttachment
      ) {
        return;
      }

      try {
        const result = await pointsLayer.queryAttachments({
          objectIds: [objectId]
        });
        const attachments = result?.[objectId] || [];
        if (attachments.length === 0) return;

        attachments.forEach((att) => {
          if (att.url && /^image\//i.test(att.contentType || "image/")) {
            const img = document.createElement("img");
            img.src = att.url;
            img.alt = att.name || "مرفق";
            img.className = "existing-attachment-thumb";
            els.existingPhotosList.appendChild(img);
          }
        });

        if (els.existingPhotosList.children.length > 0) {
          els.existingPhotosSection.hidden = false;
        }
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
      els.photoInput.value = "";
      renderPhotoGallery();
    }

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

    function formatWatermarkTimestamp(date) {
      const pad = (n) => String(n).padStart(2, "0");
      const yyyy = date.getFullYear();
      const mm = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      const hh = pad(date.getHours());
      const min = pad(date.getMinutes());
      const sec = pad(date.getSeconds());
      return `${yyyy}-${mm}-${dd}  ${hh}:${min}:${sec}`;
    }

    function getCleanPointCode(attrs) {
      if (!attrs) return "";
      const targetName = (typeof FIELDS !== "undefined" && FIELDS.name) || "Name";
      let raw = attrs[targetName];
      if (raw === undefined || raw === null || raw === "") {
        const ciKey = Object.keys(attrs).find(
          (k) => k.toLowerCase() === targetName.toLowerCase()
        );
        raw = ciKey ? attrs[ciKey] : "";
      }
      if (raw === undefined || raw === null) return "";
      // Strip leading index + dot/whitespace (e.g. "1. UN-009", "35. MO-056" -> "UN-009", "MO-056")
      return String(raw)
        .trim()
        .replace(/^\d+(?:\s*\.\s*|\s+)/, "")
        .trim();
    }

    async function buildWatermarkInfo() {
      const location = await resolvePhotoLocation();
      const timestamp = formatWatermarkTimestamp(new Date());
      const includeOrder =
        typeof IMAGE_WATERMARK === "undefined" || IMAGE_WATERMARK.includePointOrder;
      const orderNum = getStopOrderValue(activeFeature?.attributes);
      const pointCode = getCleanPointCode(activeFeature?.attributes);

      const lines = [];
      if (pointCode) {
        if (includeOrder && orderNum !== undefined && orderNum !== null) {
          lines.push(`${pointCode}  |  Stop #${orderNum}`);
        } else {
          lines.push(pointCode);
        }
        lines.push(timestamp);
      } else if (includeOrder && orderNum !== undefined && orderNum !== null) {
        lines.push(`Stop #${orderNum}  |  ${timestamp}`);
      } else {
        lines.push(timestamp);
      }

      if (location) {
        const latStr = location.lat.toFixed(6);
        const lngStr = location.lng.toFixed(6);
        const accStr =
          typeof location.accuracy === "number" && location.accuracy > 0
            ? ` (±${location.accuracy}m)`
            : "";
        lines.push(`${location.source}: ${latStr}, ${lngStr}${accStr}`);
      } else {
        lines.push("Location: Unavailable");
      }

      return lines;
    }

    function drawPhotoWatermark(ctx, width, height, lines) {
      if (!Array.isArray(lines) || lines.length === 0) return;

      const fontSize = Math.max(15, Math.round(width * 0.025));
      const lineHeight = Math.round(fontSize * 1.42);
      const padX = Math.max(14, Math.round(width * 0.022));
      const padY = Math.max(10, Math.round(fontSize * 0.65));
      const bannerHeight = lines.length * lineHeight + padY * 2;

      ctx.save();
      ctx.direction = "ltr";
      ctx.font = `700 ${fontSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      // Semi-transparent dark bottom banner for guaranteed legibility on bright/dark photos
      const grad = ctx.createLinearGradient(0, height - bannerHeight - 16, 0, height);
      grad.addColorStop(0, "rgba(15, 23, 42, 0)");
      grad.addColorStop(0.25, "rgba(15, 23, 42, 0.72)");
      grad.addColorStop(1, "rgba(15, 23, 42, 0.88)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, height - bannerHeight - 16, width, bannerHeight + 16);

      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#ffffff";

      const startY = height - bannerHeight + padY;
      lines.forEach((line, idx) => {
        ctx.fillText(line, padX, startY + idx * lineHeight);
      });
      ctx.restore();
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

    // --- Form Submission (applyEdits + Sequential Multi-Attachment Upload) ---
    els.pointForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeFeature || !pointsLayer) return;

      hideFormError();

      const committeeDecision = els.fieldCommitteeDecision.value;
      const hasBase = els.fieldHasBase.value;
      const notesObstacles = els.fieldNotesObstacles.value.trim();

      if (!committeeDecision) {
        showFormError("يرجى اختيار قرار لجنة التسليم.");
        els.fieldCommitteeDecision.focus();
        return;
      }

      if (!hasBase) {
        showFormError("يرجى تحديد ما إذا كان يوجد قاعدة بالموقع أم لا.");
        els.fieldHasBase.focus();
        return;
      }

      if (DECISIONS_REQUIRING_NOTES.has(committeeDecision) && !notesObstacles) {
        showFormError("يرجى إدخال الملاحظات / المعوقات لأن قرار اللجنة يتطلب توضيحها.");
        els.fieldNotesObstacles.focus();
        return;
      }

      setSubmittingState(true, "جاري حفظ البيانات...");

      try {
        const oidField = pointsLayer.objectIdField || "OBJECTID";
        const updatedGraphic = activeFeature.clone();

        const dateField = FIELDS.actualHandoverDate || "actual_handover_date";
        const decisionField = FIELDS.committeeDecision || "committee_decision";
        const hasBaseField = FIELDS.hasBase || "has_base";
        const notesField = FIELDS.notesObstacles || "notes_obstacles";

        const statusField = activeStatusField || FIELDS.status || "status";
        updatedGraphic.attributes[oidField] = activeFeature.attributes[oidField];
        updatedGraphic.attributes[dateField] = Date.now();
        updatedGraphic.attributes[decisionField] = committeeDecision;
        updatedGraphic.attributes[hasBaseField] = hasBase;
        updatedGraphic.attributes[notesField] = notesObstacles;
        updatedGraphic.attributes[statusField] = STATUS_VALUES.completed;

        const editResult = await pointsLayer.applyEdits({
          updateFeatures: [updatedGraphic]
        });

        const featureUpdateRes = editResult?.updateFeatureResults?.[0];
        if (featureUpdateRes?.error) {
          throw new Error(
            featureUpdateRes.error.message || "فشل تحديث بيانات النقطة في الخادم."
          );
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

        if (!isDemoMode) {
          pointsLayer.refresh();
        }
        await loadAndSyncPoints(false);

        closeBottomSheet();
        showToast("تم حفظ وإتمام النقطة بنجاح", "success");
      } catch (err) {
        console.error("Submission error:", err);
        showFormError(
          err?.message
            ? `تعذر الحفظ: ${err.message}`
            : "حدث خطأ أثناء الاتصال بالخادم. تحقق من شبكة الجوال وحاول مرة أخرى."
        );
      } finally {
        setSubmittingState(false, "حفظ وإتمام النقطة");
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

    // --- Startup Check ---
    if (POINTS_LAYER_URL && POINTS_LAYER_URL.trim() !== "") {
      initializeLayers(false);
    } else {
      els.setupModal.hidden = false;
      els.progressText.textContent = "بانتظار إعداد رابط الطبقة";
      els.nextTitle.textContent = "لم يتم ضبط POINTS_LAYER_URL";
      els.nextSubtitle.textContent = "اختر الوضع التجريبي أو أضف الرابط في js/config.js";

      els.btnStartDemo.addEventListener("click", () => {
        els.setupModal.hidden = true;
        initializeLayers(true);
      });
    }
  });
})();
