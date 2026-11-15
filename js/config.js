/* =========================================================================
 * CONFIGURATION SECTION (قم بتعديل الروابط وأسماء الحقول هنا)
 * ========================================================================= */

// رابط طبقة النقاط (ArcGIS Hosted Feature Layer) - يجب أن ينتهي بـ /FeatureServer/0
// مثال: "https://services.arcgis.com/.../arcgis/rest/services/FieldPoints/FeatureServer/0"
const POINTS_LAYER_URL = "";

// رابط طبقة المسار (اختياري) - في حال تركه فارغاً يتم رسم خط متقطع تلقائياً بين النقاط مرتبة تصاعدياً
const ROUTE_LAYER_URL = "";

// ربط أسماء الحقول الفعلية في طبقة النقاط
const FIELDS = {
  order: "order_num",   // حقل رقم الترتيب (رقمي)
  status: "status",     // حقل الحالة ("Pending" / "Completed")
  notes: "notes"        // حقل الملاحظات النصية
};

// قيم الحالة المخزنة في قاعدة البيانات
const STATUS_VALUES = {
  pending: "Pending",
  completed: "Completed"
};

// إعدادات ضغط الصور وختم التاريخ والموقع قبل الرفع عبر شبكة الجوال
const IMAGE_COMPRESSION = {
  enabled: true,
  maxWidth: 1280,
  quality: 0.8
};

// كتابة التاريخ والوقت والإحداثيات على الصورة الملتقطة تلقائياً
const IMAGE_WATERMARK = {
  enabled: true,
  includePointOrder: true
};

// إعدادات الخريطة الافتراضية (يتم التقريب تلقائياً إلى حدود النقاط عند التحميل)
const MAP_CONFIG = {
  basemap: "hybrid", // صور فضائية مع أسماء الشوارع (أو "satellite" لصور فضائية فقط بدون أسماء)
  defaultCenter: [46.6753, 24.7136], // [خط الطول, دائرة العرض]
  defaultZoom: 12
};

// الحقول النظامية التي يتم تجاهلها عند توليد حقول النموذج تلقائياً
const SYSTEM_FIELD_PATTERN =
  /^(objectid|globalid|fid|shape.*|creationdate|creator|editdate|editor)$/i;
