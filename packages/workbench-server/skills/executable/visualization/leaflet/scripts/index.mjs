const LATITUDE_CANDIDATES = ["latitude", "lat", "纬度", "纬度坐标"];
const LONGITUDE_CANDIDATES = ["longitude", "lng", "lon", "经度", "经度坐标"];
const LABEL_CANDIDATES = ["name", "名称", "地点", "地址", "位置", "门店", "城市", "地区"];

function findField(rows, configuredField, candidates) {
  if (configuredField && rows.some((row) => Object.prototype.hasOwnProperty.call(row, configuredField))) {
    return configuredField;
  }
  const fields = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  const lowerCaseFields = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const match = lowerCaseFields.get(candidate.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function toCoordinate(value, min, max) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorResult(message, meta = {}) {
  return {
    html: `<div style="padding:20px;text-align:center;color:#666;">${escapeHtml(message)}</div>`,
    meta: { error: true, ...meta },
  };
}

function generateHtml({ title, points, valueField, showTitle, locale }) {
  const safeTitle = escapeHtml(title);
  const serializedPoints = JSON.stringify(points).replace(/</g, "\\u003c");
  const serializedValueField = JSON.stringify(valueField || null);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/api/skills/resources/executable/visualization/leaflet/scripts/leaflet.css">
  <style>
    html, body, #map { height: 100%; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--map-bg, Canvas); color: var(--map-text, CanvasText); }
    .map-shell { height: 100%; display: flex; flex-direction: column; }
    .map-title { padding: 12px 16px; font-size: 16px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    #map { flex: 1; min-height: 0; background: var(--map-bg, Canvas); }
    .leaflet-popup-content { margin: 12px 14px; min-width: 180px; }
    .popup-title { font-weight: 600; margin-bottom: 6px; }
    .popup-row { display: flex; gap: 12px; margin-top: 4px; font-size: 12px; }
    .popup-key { color: var(--map-muted, GrayText); }
    .leaflet-popup-content-wrapper, .leaflet-popup-tip, .leaflet-bar a { background: var(--map-bg, Canvas); color: var(--map-text, CanvasText); }
  </style>
</head>
<body>
  <div class="map-shell">${showTitle === false ? '' : `<div class="map-title">${safeTitle}</div>`}<div id="map"></div></div>
  <script src="/api/skills/resources/executable/visualization/leaflet/scripts/leaflet.js"></script>
  <script>
    const points = ${serializedPoints};
    const valueField = ${serializedValueField};
    const locale = ${JSON.stringify(locale || 'en')};
    const isChinese = locale.startsWith('zh');
    if (!window.L) {
      document.getElementById("map").textContent = isChinese ? "地图资源加载失败，请检查网络连接。" : "Failed to load map resources.";
      throw new Error("Leaflet library failed to load");
    }
    const map = L.map("map", { scrollWheelZoom: false, zoomControl: false });
    L.control.zoom({ zoomInTitle: isChinese ? '放大' : 'Zoom in', zoomOutTitle: isChinese ? '缩小' : 'Zoom out' }).addTo(map);
    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const tileLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Tiles &copy; Esri — Sources: Esri, HERE, Garmin, USGS, OpenStreetMap contributors"
    }).addTo(map);
    const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const bounds = [];
    const markers = [];
    const createPopupRow = (key, value) => {
      const row = document.createElement("div");
      row.className = "popup-row";
      const keyElement = document.createElement("span");
      keyElement.className = "popup-key";
      keyElement.textContent = String(key);
      const valueElement = document.createElement("span");
      valueElement.textContent = String(value ?? "");
      row.append(keyElement, valueElement);
      return row;
    };
    for (const point of points) {
      const numericValue = Number(point.value);
      const radius = Number.isFinite(numericValue) && maxValue > minValue ? 7 + ((numericValue - minValue) / (maxValue - minValue)) * 13 : 9;
      const marker = L.circleMarker([point.latitude, point.longitude], {
        radius, color: "#1d4ed8", weight: 1.5, fillColor: "#3b82f6", fillOpacity: 0.7
      }).addTo(map);
      markers.push(marker);
      const popup = document.createElement("div");
      const popupTitle = document.createElement("div");
      popupTitle.className = "popup-title";
      popupTitle.textContent = point.label;
      popup.appendChild(popupTitle);
      if (valueField && point.value !== undefined) popup.appendChild(createPopupRow(valueField, point.value));
      for (const [key, value] of Object.entries(point.properties)) {
        if (key !== "__label" && key !== valueField) popup.appendChild(createPopupRow(key, value));
      }
      marker.bindPopup(popup);
      bounds.push([point.latitude, point.longitude]);
    }
    if (bounds.length === 1) map.setView(bounds[0], 12);
    else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
    setTimeout(() => map.invalidateSize(), 0);
    new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
    function updateTheme() {
      const host = window.frameElement || document.documentElement;
      const style = host.ownerDocument.defaultView.getComputedStyle(host);
      const color = style.getPropertyValue('--el-color-primary').trim() || '#409eff';
      const probe = host.ownerDocument.createElement('span');
      probe.style.color = style.getPropertyValue('--el-bg-color').trim() || 'Canvas';
      host.ownerDocument.body.appendChild(probe);
      const channels = host.ownerDocument.defaultView.getComputedStyle(probe).color.match(/[\\d.]+/g)?.map(Number);
      probe.remove();
      const dark = channels && channels.length >= 3 ? channels[0] * .299 + channels[1] * .587 + channels[2] * .114 < 128 : isDark;
      map.getPane('tilePane').style.filter = dark ? 'invert(1) hue-rotate(180deg) brightness(.8) saturate(.65)' : '';
      for (const [name, token] of [['bg','--el-bg-color'],['text','--el-text-color-primary'],['muted','--el-text-color-secondary']]) {
        document.documentElement.style.setProperty('--map-' + name, style.getPropertyValue(token).trim());
      }
      markers.forEach(marker => marker.setStyle({ color, fillColor: color }));
    }
    updateTheme();
    const timer = setInterval(updateTheme, 500);
    window.addEventListener('pagehide', () => { clearInterval(timer); map.remove(); }, { once: true });
  </script>
</body>
</html>`;
}

export async function execute(input) {
  const data = Array.isArray(input?.data) ? input.data.filter((row) => row && typeof row === "object") : [];
  const chartType = input?.chartType || "leaflet-map";
  const title = String(input?.title || "").trim();

  if (chartType !== "leaflet-map") return errorResult("Leaflet only supports chartType: leaflet-map", { chartType });
  if (!title) return errorResult("Missing required parameter: title", { missingParams: { title } });
  if (!data.length) return errorResult("Data is empty");

  const latitudeField = findField(data, input?.latitudeField, LATITUDE_CANDIDATES);
  const longitudeField = findField(data, input?.longitudeField, LONGITUDE_CANDIDATES);
  if (!latitudeField || !longitudeField) {
    return errorResult("Missing latitude/longitude fields", { missingParams: { latitudeField, longitudeField } });
  }

  const labelField = findField(data, input?.labelField, LABEL_CANDIDATES);
  const valueField = input?.valueField && data.some((row) => Object.prototype.hasOwnProperty.call(row, input.valueField))
    ? input.valueField
    : undefined;
  let skippedRows = 0;
  const points = data.flatMap((row, index) => {
    const latitude = toCoordinate(row[latitudeField], -90, 90);
    const longitude = toCoordinate(row[longitudeField], -180, 180);
    if (latitude === undefined || longitude === undefined) {
      skippedRows += 1;
      return [];
    }
    const label = labelField && row[labelField] != null && String(row[labelField]).trim()
      ? String(row[labelField])
      : `Point ${index + 1}`;
    return [{ latitude, longitude, label, value: valueField ? row[valueField] : undefined, properties: row }];
  });

  if (!points.length) return errorResult("No rows contain valid latitude and longitude", { latitudeField, longitudeField });

  return {
    html: generateHtml({ title, points, valueField, showTitle: input.showTitle, locale: input.locale }),
    meta: { skillId: "leaflet", chartType, title, dataRows: points.length, originalRows: data.length, skippedRows, latitudeField, longitudeField, labelField, valueField },
  };
}
