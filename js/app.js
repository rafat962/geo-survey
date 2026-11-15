/* =========================================================================
 * FIELD DATA COLLECTION & ROUTE NAVIGATION APP
 * ========================================================================= */

(function () {
  const IS_LOCAL_FILE = location.protocol === "file:";

  async function initSessionControls() {
    const userBadge = document.getElementById("userBadge");
    const btnLogout = document.getElementById("btnLogout");

    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        if (IS_LOCAL_FILE) {
          location.href = "login/index.html";
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
        window.location.replace("/login/");
      });
    }

    if (IS_LOCAL_FILE) return;

    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.status === 401) {
        window.location.replace("/login/");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated && data.user && userBadge) {
          userBadge.textContent = data.user;
          userBadge.hidden = false;
        } else if (!data?.authenticated) {
          window.location.replace("/login/");
        }
      }
    } catch (err) {
      // Allow static preview if worker API is not mounted (e.g. plain static file server)
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
    "esri/renderers/UniqueValueRenderer",
    "esri/symbols/SimpleMarkerSymbol",
    "esri/symbols/SimpleLineSymbol",
    "esri/layers/support/LabelClass"
  ], function (
    Map,
    MapView,
    FeatureLayer,
    GraphicsLayer,
    Graphic,
    Point,
    Polyline,
    Track,
    UniqueValueRenderer,
    SimpleMarkerSymbol,
    SimpleLineSymbol,
    LabelClass
  ) {
    // --- DOM References ---
    const els = {
      progressText: document.getElementById("progressText"),
      progressPercent: document.getElementById("progressPercent"),
      progressFill: document.getElementById("progressFill"),
      nextBanner: document.getElementById("nextBanner"),
      nextTitle: document.getElementById("nextTitle"),
      nextSubtitle: document.getElementById("nextSubtitle"),
      btnNavigateNext: document.getElementById("btnNavigateNext"),
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
      btnCloseSheet: document.getElementById("btnCloseSheet"),
      pointForm: document.getElementById("pointForm"),
      dynamicFieldsContainer: document.getElementById("dynamicFieldsContainer"),
      existingPhotosSection: document.getElementById("existingPhotosSection"),
      existingPhotosList: document.getElementById("existingPhotosList"),
      photoInput: document.getElementById("photoInput"),
      btnPickPhoto: document.getElementById("btnPickPhoto"),
      photoPreviewWrap: document.getElementById("photoPreviewWrap"),
      photoPreviewImg: document.getElementById("photoPreviewImg"),
      photoSizeInfo: document.getElementById("photoSizeInfo"),
      btnRemovePhoto: document.getElementById("btnRemovePhoto"),
      formError: document.getElementById("formError"),
      btnSubmitForm: document.getElementById("btnSubmitForm"),
      submitSpinner: document.getElementById("submitSpinner"),
      submitBtnText: document.getElementById("submitBtnText")
    };

    // --- State ---
    let pointsLayer = null;
    let routeLayer = null;
    let highlightLayer = new GraphicsLayer({ id: "next-point-highlight" });
    let cachedFeatures = [];
    let nextPendingFeature = null;
    let activeFeature = null;
    let compressedPhotoBlob = null;
    let compressedPhotoFilename = "field_photo.jpg";
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
      popup: {
        autoOpenEnabled: false
      },
      padding: {
        top: 145,
        bottom: 40,
        left: 16,
        right: 16
      }
    });

    // --- Live GPS Track Widget ---
    const track = new Track({
      view: view,
      goToLocationEnabled: true,
      useHeadingEnabled: true
    });
    view.ui.add(track, "bottom-left");

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
    function createPointsRenderer() {
      const pendingSymbol = new SimpleMarkerSymbol({
        style: "circle",
        color: "#ea580c",
        size: "28px",
        outline: {
          color: "#ffffff",
          width: 2.5
        }
      });

      const completedSymbol = new SimpleMarkerSymbol({
        style: "circle",
        color: "#16a34a",
        size: "26px",
        outline: {
          color: "#ffffff",
          width: 2.5
        }
      });

      return new UniqueValueRenderer({
        field: FIELDS.status,
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

    function createNumberedLabeling() {
      return [
        new LabelClass({
          labelPlacement: "center-center",
          labelExpressionInfo: {
            expression: `$feature.${FIELDS.order}`
          },
          symbol: {
            type: "text",
            color: "#ffffff",
            haloColor: "rgba(15, 23, 42, 0.55)",
            haloSize: "1.2px",
            font: {
              family: "Arial, sans-serif",
              size: "12px",
              weight: "bold"
            }
          }
        })
      ];
    }

    // --- Layer Initialization ---
    function initializeLayers(useDemo) {
      isDemoMode = useDemo;
      els.demoBadge.classList.toggle("visible", useDemo);

      if (ROUTE_LAYER_URL && ROUTE_LAYER_URL.trim() !== "") {
        routeLayer = new FeatureLayer({
          url: ROUTE_LAYER_URL.trim(),
          popupEnabled: false
        });
      } else {
        routeLayer = new GraphicsLayer({ id: "auto-route-layer" });
      }

      if (useDemo) {
        pointsLayer = createDemoFeatureLayer();
      } else {
        pointsLayer = new FeatureLayer({
          url: POINTS_LAYER_URL.trim(),
          outFields: ["*"],
          popupEnabled: false,
          renderer: createPointsRenderer(),
          labelingInfo: createNumberedLabeling()
        });
      }

      map.addMany([routeLayer, highlightLayer, pointsLayer]);

      pointsLayer
        .load()
        .then(() => {
          return loadAndSyncPoints(true);
        })
        .catch((err) => {
          console.error("Failed to load points layer:", err);
          els.progressText.textContent = "تعذر تحميل طبقة النقاط";
          els.nextTitle.textContent = "خطأ في الاتصال بالطبقة";
          els.nextSubtitle.textContent = "تأكد من رابط الطبقة وصلاحيات الوصول";
          showToast("فشل تحميل طبقة النقاط. تحقق من الرابط والإنترنت.", "error", 5000);
        });
    }

    function createDemoFeatureLayer() {
      const baseLat = 24.7136;
      const baseLng = 46.6753;
      const samplePoints = [
        { order: 1, status: STATUS_VALUES.completed, notes: "تم فحص المحول الرئيسي", site: "حي العليا - محطة 1" },
        { order: 2, status: STATUS_VALUES.completed, notes: "قراءة العداد مطابقة", site: "طريق الملك فهد" },
        { order: 3, status: STATUS_VALUES.pending, notes: "", site: "شارع التحلية - نقطة 3" },
        { order: 4, status: STATUS_VALUES.pending, notes: "مطلوب تصوير اللوحة", site: "حي السليمانية - نقطة 4" },
        { order: 5, status: STATUS_VALUES.pending, notes: "", site: "حي الورود - نقطة 5" },
        { order: 6, status: STATUS_VALUES.pending, notes: "", site: "طريق العروبة - نقطة 6" }
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
            [FIELDS.order]: pt.order,
            [FIELDS.status]: pt.status,
            [FIELDS.notes]: pt.notes,
            site_name: pt.site
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
          { name: FIELDS.order, alias: "رقم النقطة", type: "integer", editable: false },
          {
            name: FIELDS.status,
            alias: "الحالة",
            type: "string",
            editable: true,
            domain: {
              type: "coded-value",
              name: "StatusDomain",
              codedValues: [
                { name: "قيد الانتظار (Pending)", code: STATUS_VALUES.pending },
                { name: "مكتملة (Completed)", code: STATUS_VALUES.completed }
              ]
            }
          },
          { name: "site_name", alias: "اسم الموقع", type: "string", length: 100, editable: true },
          { name: FIELDS.notes, alias: "ملاحظات الميدان", type: "string", length: 500, editable: true }
        ],
        popupEnabled: false,
        renderer: createPointsRenderer(),
        labelingInfo: createNumberedLabeling()
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
        const valA = Number(a.attributes?.[FIELDS.order]);
        const valB = Number(b.attributes?.[FIELDS.order]);
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
        isCompletedStatus(f.attributes?.[FIELDS.status])
      ).length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

      els.progressText.textContent = `تم إنجاز ${completed} من ${total} نقطة`;
      els.progressPercent.textContent = `${pct}%`;
      els.progressFill.style.width = `${pct}%`;
    }

    function updateNextPendingPoint(sortedFeatures) {
      nextPendingFeature =
        sortedFeatures.find((f) => !isCompletedStatus(f.attributes?.[FIELDS.status])) || null;

      if (!nextPendingFeature) {
        els.nextBanner.classList.add("all-done");
        els.nextTitle.textContent = "تم إنجاز جميع النقاط بنجاح!";
        els.nextSubtitle.textContent = "لا توجد نقاط متبقية في المسار";
        els.btnNavigateNext.hidden = true;
        clearNextPointHalo();
        return;
      }

      const orderNum = nextPendingFeature.attributes?.[FIELDS.order] ?? "--";
      els.nextBanner.classList.remove("all-done");
      els.nextTitle.textContent = `النقطة التالية: رقم ${orderNum}`;
      els.nextSubtitle.textContent = "اضغط توجيه للانتقال إليها على الخريطة";
      els.btnNavigateNext.hidden = false;

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
          color: [56, 189, 248, 0.95],
          width: 3.5,
          style: "dash"
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
          color: [251, 146, 60, 0.18],
          size: "46px",
          outline: {
            color: [249, 115, 22, 0.9],
            width: 2.5
          }
        })
      });

      const pulseRing = new Graphic({
        geometry: geometry,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [251, 146, 60, 0],
          size: "36px",
          outline: {
            color: [249, 115, 22, 0.85],
            width: 2.5
          }
        })
      });

      highlightLayer.addMany([outerRing, pulseRing]);

      let step = 0;
      pulseIntervalId = setInterval(() => {
        step = (step + 1) % 30;
        const progress = step / 30;
        const sizePx = 32 + progress * 28;
        const alpha = Math.max(0, 0.9 * (1 - progress));

        pulseRing.symbol = new SimpleMarkerSymbol({
          style: "circle",
          color: [251, 146, 60, 0],
          size: `${sizePx.toFixed(1)}px`,
          outline: {
            color: [249, 115, 22, alpha],
            width: 2.5
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

    // --- Map Interactions & Floating Buttons ---
    els.btnNavigateNext.addEventListener("click", () => {
      if (!nextPendingFeature || !nextPendingFeature.geometry) return;
      view
        .goTo(
          { target: nextPendingFeature.geometry, zoom: Math.max(view.zoom, 17) },
          { duration: 700 }
        )
        .catch(() => {});
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

    // --- Bottom Sheet & Dynamic Form Generation ---
    function openBottomSheet(graphic) {
      const oidField = pointsLayer.objectIdField || "OBJECTID";
      const oid = graphic.attributes?.[oidField];
      const fullGraphic =
        cachedFeatures.find((f) => f.attributes?.[oidField] === oid) || graphic;

      activeFeature = fullGraphic;
      resetPhotoState();
      hideFormError();

      const attrs = fullGraphic.attributes || {};
      const orderVal = attrs[FIELDS.order] ?? "--";
      const completed = isCompletedStatus(attrs[FIELDS.status]);

      els.sheetTitle.textContent = `نقطة رقم ${orderVal}`;
      els.sheetStatusBadge.textContent = completed ? "مكتملة" : "قيد الانتظار";
      els.sheetStatusBadge.className = `status-badge ${completed ? "completed" : "pending"}`;

      renderDynamicFormFields(attrs);
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

    function renderDynamicFormFields(attrs) {
      els.dynamicFieldsContainer.innerHTML = "";
      const fields = Array.isArray(pointsLayer?.fields) ? pointsLayer.fields : [];

      const editableFields = fields.filter((field) => {
        if (!field || !field.name) return false;
        if (field.editable === false) return false;
        if (
          field.type === "oid" ||
          field.type === "global-id" ||
          field.type === "geometry"
        ) {
          return false;
        }
        if (SYSTEM_FIELD_PATTERN.test(field.name)) return false;
        if (field.name === FIELDS.order) return false;
        return true;
      });

      if (editableFields.length === 0) {
        els.dynamicFieldsContainer.appendChild(
          buildFieldElement(
            { name: FIELDS.status, alias: "الحالة", type: "string" },
            attrs[FIELDS.status] ?? STATUS_VALUES.completed
          )
        );
        els.dynamicFieldsContainer.appendChild(
          buildFieldElement(
            { name: FIELDS.notes, alias: "الملاحظات", type: "string", length: 500 },
            attrs[FIELDS.notes] ?? ""
          )
        );
        return;
      }

      editableFields.forEach((field) => {
        const value = attrs[field.name];
        els.dynamicFieldsContainer.appendChild(buildFieldElement(field, value));
      });
    }

    function buildFieldElement(field, rawValue) {
      const wrapper = document.createElement("div");
      wrapper.className = "form-field";

      const label = document.createElement("label");
      label.className = "form-label";
      const fieldId = `field_${field.name}`;
      label.setAttribute("for", fieldId);
      label.textContent = getArabicFieldLabel(field);
      wrapper.appendChild(label);

      let control;

      if (field.domain && field.domain.type === "coded-value" && Array.isArray(field.domain.codedValues)) {
        control = document.createElement("select");
        control.className = "form-control";
        field.domain.codedValues.forEach((cv) => {
          const opt = document.createElement("option");
          opt.value = cv.code;
          opt.textContent = cv.name;
          control.appendChild(opt);
        });
        if (field.name === FIELDS.status) {
          control.value = STATUS_VALUES.completed;
        } else if (rawValue !== null && rawValue !== undefined) {
          control.value = String(rawValue);
        }
      } else if (field.name === FIELDS.status) {
        control = document.createElement("select");
        control.className = "form-control";
        [
          { code: STATUS_VALUES.completed, label: "مكتملة (Completed)" },
          { code: STATUS_VALUES.pending, label: "قيد الانتظار (Pending)" }
        ].forEach((item) => {
          const opt = document.createElement("option");
          opt.value = item.code;
          opt.textContent = item.label;
          control.appendChild(opt);
        });
        control.value = STATUS_VALUES.completed;
      } else if (field.type === "date") {
        control = document.createElement("input");
        control.type = "date";
        control.className = "form-control";
        if (rawValue) {
          const d = new Date(rawValue);
          if (!Number.isNaN(d.getTime())) {
            control.value = d.toISOString().split("T")[0];
          }
        }
      } else if (
        field.type === "integer" ||
        field.type === "small-integer" ||
        field.type === "double" ||
        field.type === "single"
      ) {
        control = document.createElement("input");
        control.type = "number";
        control.step = field.type === "double" || field.type === "single" ? "any" : "1";
        control.inputMode = "decimal";
        control.className = "form-control";
        if (rawValue !== null && rawValue !== undefined) {
          control.value = String(rawValue);
        }
      } else if (field.name === FIELDS.notes || (field.length && field.length > 120)) {
        control = document.createElement("textarea");
        control.className = "form-control";
        control.placeholder = "أدخل الملاحظات الميدانية هنا...";
        control.value = rawValue ?? "";
      } else {
        control = document.createElement("input");
        control.type = "text";
        control.className = "form-control";
        control.value = rawValue ?? "";
      }

      control.id = fieldId;
      control.name = field.name;
      control.dataset.fieldType = field.type || "string";
      wrapper.appendChild(control);

      return wrapper;
    }

    function getArabicFieldLabel(field) {
      if (field.name === FIELDS.status) return "الحالة (سيتم تعيينها كمكتملة تلقائياً عند الحفظ)";
      if (field.name === FIELDS.notes) return "الملاحظات";
      return field.alias || field.name;
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

    // --- Photo Selection & Canvas Compression ---
    els.btnPickPhoto.addEventListener("click", () => {
      els.photoInput.click();
    });

    els.btnRemovePhoto.addEventListener("click", resetPhotoState);

    els.photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      hideFormError();

      try {
        if (IMAGE_COMPRESSION.enabled) {
          const compressed = await compressImage(
            file,
            IMAGE_COMPRESSION.maxWidth,
            IMAGE_COMPRESSION.quality
          );
          compressedPhotoBlob = compressed.blob;
          compressedPhotoFilename = buildJpgFilename(file.name);
          els.photoPreviewImg.src = compressed.dataUrl;
          els.photoSizeInfo.textContent =
            `تم الضغط: ${formatBytes(compressed.compressedSize)} (بدلاً من ${formatBytes(compressed.originalSize)})`;
        } else {
          compressedPhotoBlob = file;
          compressedPhotoFilename = file.name || "field_photo.jpg";
          els.photoPreviewImg.src = URL.createObjectURL(file);
          els.photoSizeInfo.textContent = `الحجم: ${formatBytes(file.size)}`;
        }

        els.photoPreviewWrap.classList.add("visible");
      } catch (err) {
        console.error("Image compression error:", err);
        showFormError("تعذر معالجة الصورة المختارة. يرجى المحاولة بصورة أخرى.");
        resetPhotoState();
      }
    });

    function resetPhotoState() {
      compressedPhotoBlob = null;
      compressedPhotoFilename = "field_photo.jpg";
      els.photoInput.value = "";
      els.photoPreviewImg.src = "";
      els.photoPreviewWrap.classList.remove("visible");
    }

    function buildJpgFilename(originalName) {
      const base = (originalName || "field_photo").replace(/\.[^/.]+$/, "");
      return `${base}.jpg`;
    }

    function compressImage(file, maxWidth, quality) {
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

          if (targetWidth > maxWidth) {
            const ratio = maxWidth / targetWidth;
            targetWidth = maxWidth;
            targetHeight = Math.round(targetHeight * ratio);
          }

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

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

    // --- Form Submission (applyEdits + addAttachment) ---
    els.pointForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeFeature || !pointsLayer) return;

      hideFormError();
      setSubmittingState(true, "جاري حفظ البيانات...");

      try {
        const oidField = pointsLayer.objectIdField || "OBJECTID";
        const updatedGraphic = activeFeature.clone();

        const controls = els.dynamicFieldsContainer.querySelectorAll("[name]");
        controls.forEach((ctrl) => {
          const fieldName = ctrl.name;
          const fieldType = ctrl.dataset.fieldType;
          let val = ctrl.value;

          if (
            fieldType === "integer" ||
            fieldType === "small-integer" ||
            fieldType === "double" ||
            fieldType === "single"
          ) {
            val = val === "" ? null : Number(val);
          } else if (fieldType === "date") {
            val = val ? new Date(val).getTime() : null;
          }

          updatedGraphic.attributes[fieldName] = val;
        });

        if (!updatedGraphic.attributes[FIELDS.status]) {
          updatedGraphic.attributes[FIELDS.status] = STATUS_VALUES.completed;
        }
        updatedGraphic.attributes[oidField] = activeFeature.attributes[oidField];

        const editResult = await pointsLayer.applyEdits({
          updateFeatures: [updatedGraphic]
        });

        const featureUpdateRes = editResult?.updateFeatureResults?.[0];
        if (featureUpdateRes?.error) {
          throw new Error(
            featureUpdateRes.error.message || "فشل تحديث بيانات النقطة في الخادم."
          );
        }

        if (compressedPhotoBlob) {
          if (isDemoMode) {
            setSubmittingState(true, "جاري رفع الصورة (تجريبي)...");
            await new Promise((r) => setTimeout(r, 450));
          } else {
            setSubmittingState(true, "جاري رفع الصورة...");
            const formData = new FormData();
            formData.append("attachment", compressedPhotoBlob, compressedPhotoFilename);

            const attachRes = await pointsLayer.addAttachment(updatedGraphic, formData);
            if (attachRes?.error) {
              throw new Error(
                attachRes.error.message || "تم حفظ البيانات ولكن فشل رفع الصورة المرفقة."
              );
            }
          }
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
