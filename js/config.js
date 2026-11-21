/* =========================================================================
 * CONFIGURATION SECTION (قم بتعديل الروابط وأسماء الحقول هنا)
 * ========================================================================= */

// رابط طبقة النقاط (ArcGIS Hosted Feature Layer) - يدعم /FeatureServer أو /FeatureServer/0
const POINTS_LAYER_URL =
  "https://services-ap1.arcgis.com/HRZVvitYCIwFb7oA/arcgis/rest/services/makkah_21_11_2026/FeatureServer"; // رابط طبقة المسار (اختياري) - في حال تركه فارغاً أو عدم وجود طبقة خطوط داخل الخدمة تُعرض النقاط فقط
const ROUTE_LAYER_URL =
  "https://services-ap1.arcgis.com/HRZVvitYCIwFb7oA/arcgis/rest/services/makkah_21_11_2026/FeatureServer"; // ربط أسماء الحقول الفعلية في طبقة النقاط
const FIELDS = {
  name: "Name", // اسم/كود النقطة في الطبقة (مثال: 1. UN-009)
  district: "district", // اسم الحي للختم على الصورة
  streetName: "street_name", // اسم الشارع للختم على الصورة
  order: "Sequence", // حقل رقم الترتيب الأساسي (ArcGIS Plan Routes)
  orderFallback: "order_num", // حقل الترتيب البديل في حال عدم وجود Sequence
  status: "status", // حقل الحالة ("Pending" / "Completed")
  actualHandoverDate: "actual_handover_date", // تاريخ الاستلام الفعلي (Date)
  committeeDecision: "committee_decision", // قرار لجنة التسليم (String >= 100 حرف)
  hasBase: "has_base", // يوجد قاعدة بالموقع (String)
  notesObstacles: "notes_obstacles", // الملاحظات / المعوقات (String)
};

// قيم الحالة المخزنة في قاعدة البيانات
const STATUS_VALUES = {
  pending: "Pending",
  completed: "Completed",
};

// إعدادات ضغط الصور وختم التاريخ والموقع قبل الرفع عبر شبكة الجوال
const IMAGE_COMPRESSION = {
  enabled: true,
  maxWidth: 1280,
  quality: 0.8,
};

// كتابة التاريخ والوقت والإحداثيات على الصورة الملتقطة تلقائياً
const IMAGE_WATERMARK = {
  enabled: true,
  includePointOrder: true,
};

// إعدادات الخريطة الافتراضية (يتم التقريب تلقائياً إلى حدود النقاط عند التحميل)
const MAP_CONFIG = {
  basemap: "hybrid", // صور فضائية (Imagery Hybrid) مع أسماء الشوارع والمعالم
  defaultCenter: [39.8262, 21.4225], // [خط الطول, دائرة العرض]
  defaultZoom: 12,
};

// الحقول النظامية التي يتم تجاهلها عند توليد حقول النموذج تلقائياً
const SYSTEM_FIELD_PATTERN =
  /^(objectid|globalid|fid|shape.*|creationdate|creator|editdate|editor)$/i;
