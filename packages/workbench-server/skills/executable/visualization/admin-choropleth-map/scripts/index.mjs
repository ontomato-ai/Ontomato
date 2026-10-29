import { readFileSync as readBundledAsset } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(MODULE_DIR, "..");
const BUNDLED_CHINA_PROVINCES = path.join(SKILL_ROOT, "data", "geojson", "china-provinces.geojson");
const DEFAULT_CHINA_PROVINCES_URL = "https://geojson.cn/api/china/1.6.3/100000.json";
let bundledGeoJSONPromise;
const GEOJSON_SOURCE = "GeoJSON.CN China administrative boundary dataset v1.6.3 (GCJ-02); see data/geojson/README.md";

const REGION_CODE_FIELDS = ["adcode", "code", "gb", "regionCode", "region_code", "provinceCode", "province_code", "行政区划代码", "区域编码", "省级代码"];
const FEATURE_CODE_FIELDS = ["code", "adcode", "gb", "regionCode", "region_code", "provinceCode", "province_code"];
const REGION_ALIASES = {
  "北京":"北京","北京市":"北京","天津":"天津","天津市":"天津","上海":"上海","上海市":"上海","重庆":"重庆","重庆市":"重庆",
  "河北":"河北","河北省":"河北","山西":"山西","山西省":"山西","内蒙古":"内蒙古","内蒙古自治区":"内蒙古",
  "辽宁":"辽宁","辽宁省":"辽宁","吉林":"吉林","吉林省":"吉林","黑龙江":"黑龙江","黑龙江省":"黑龙江",
  "江苏":"江苏","江苏省":"江苏","浙江":"浙江","浙江省":"浙江","安徽":"安徽","安徽省":"安徽","福建":"福建","福建省":"福建",
  "江西":"江西","江西省":"江西","山东":"山东","山东省":"山东","河南":"河南","河南省":"河南","湖北":"湖北","湖北省":"湖北",
  "湖南":"湖南","湖南省":"湖南","广东":"广东","广东省":"广东","广西":"广西","广西壮族自治区":"广西",
  "海南":"海南","海南省":"海南","四川":"四川","四川省":"四川","贵州":"贵州","贵州省":"贵州","云南":"云南","云南省":"云南",
  "西藏":"西藏","西藏自治区":"西藏","陕西":"陕西","陕西省":"陕西","甘肃":"甘肃","甘肃省":"甘肃","青海":"青海","青海省":"青海",
  "宁夏":"宁夏","宁夏回族自治区":"宁夏","新疆":"新疆","新疆维吾尔自治区":"新疆","香港":"香港","香港特别行政区":"香港",
  "澳门":"澳门","澳门特别行政区":"澳门","台湾":"台湾","台湾省":"台湾"
};
function normalizeRegion(value) {
  const raw = String(value ?? "").trim().toLocaleLowerCase().replace(/[\s\u3000]/g, "");
  return REGION_ALIASES[raw] || raw;
}
function regionKeysFromRow(row, regionField) {
  const keys = new Set();
  const add = value => { const key = normalizeRegion(value); if (key) keys.add(key); };
  for (const field of REGION_CODE_FIELDS) if (row?.[field] !== undefined && row?.[field] !== null) add(row[field]);
  add(row?.[regionField]);
  return [...keys];
}
function regionKeysFromFeature(feature, preferredNameField) {
  const p = feature?.properties || {};
  const keys = new Set();
  const add = value => { const key = normalizeRegion(value); if (key) keys.add(key); };
  for (const field of FEATURE_CODE_FIELDS) add(p[field]);
  if (preferredNameField) add(p[preferredNameField]);
  for (const field of ["name", "fullname", "fullName", "NAME", "name_zh", "province", "region", "行政区", "省份"]) add(p[field]);
  return [...keys];
}
function isPolygonFeatureCollection(value) {
  return !!value && value.type === "FeatureCollection" && Array.isArray(value.features) && value.features.some(f => f?.geometry && ["Polygon", "MultiPolygon"].includes(f.geometry.type));
}
async function loadBundledChinaProvinces() {
  if (!bundledGeoJSONPromise) {
    bundledGeoJSONPromise = (async () => {
      try {
        const raw = await readFile(BUNDLED_CHINA_PROVINCES, "utf8");
        const parsed = JSON.parse(raw);
        if (isPolygonFeatureCollection(parsed)) return { geojson: parsed, source: "bundled:data/geojson/china-provinces.geojson" };
      } catch { /* not installed yet; continue to remote fallback */ }
      return null;
    })();
  }
  return bundledGeoJSONPromise;
}
async function resolveGeoJSON(input, dataRoot) {
  const supplied = input?.geojson || dataRoot?.geojson;
  if (supplied) {
    const parsed = typeof supplied === "string" ? JSON.parse(supplied) : supplied;
    return { geojson: parsed, source: "input" };
  }
  if (input?.autoLoadGeoJSON === false || (input?.boundarySet && input.boundarySet !== "china-provinces")) return null;
  const local = await loadBundledChinaProvinces();
  if (local) return local;
  const url = typeof input?.geojsonUrl === "string" && input.geojsonUrl.trim() ? input.geojsonUrl.trim() : DEFAULT_CHINA_PROVINCES_URL;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/geo+json, application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      if (!isPolygonFeatureCollection(parsed)) throw new Error("response is not a polygon FeatureCollection");
      try {
        await mkdir(path.dirname(BUNDLED_CHINA_PROVINCES), { recursive: true });
        await writeFile(BUNDLED_CHINA_PROVINCES, JSON.stringify(parsed), "utf8");
      } catch { /* caching is optional; the current render can still use the fetched data */ }
      return { geojson: parsed, source: `remote:${url}` };
    } finally { clearTimeout(timeout); }
  } catch (error) {
    return { geojson: null, source: null, loadError: String(error?.message || error) };
  }
}

const DEFAULT_RAMP = ["#eff6ff", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"];
const REGION_FIELDS = ["region", "province", "city", "district", "area", "name", "地区", "省份", "城市", "区县", "行政区", "行政区划代码", "adcode", "code"];
const FEATURE_NAME_FIELDS = ["name", "fullname", "fullName", "NAME", "name_zh", "NAME_1", "region", "province", "city", "district", "adcode", "code", "gb"];
function esc(value) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function jsonForScript(value) { return JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029"); }
function findField(rows, configured, candidates) {
  if (configured && rows.some(r => r && Object.prototype.hasOwnProperty.call(r, configured))) return configured;
  const fields = [...new Set(rows.flatMap(r => r && typeof r === "object" ? Object.keys(r) : []))];
  const byLower = new Map(fields.map(f => [f.toLowerCase(), f]));
  for (const c of candidates) if (byLower.has(String(c).toLowerCase())) return byLower.get(String(c).toLowerCase());
  return undefined;
}
function errorResult(message, meta = {}) {
  return { html: `<!doctype html><html><body style="font:14px sans-serif;padding:20px;color:#b91c1c">${esc(message)}</body></html>`, meta: { skillId:"admin-choropleth-map", chartType:"admin-choropleth-map", error:true, warnings:[], ...meta } };
}
function numeric(value) { if (value === null || value === undefined || String(value).trim() === "") return undefined; const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim()); return Number.isFinite(n) ? n : undefined; }
function generateHtml({ title, geojson, rows, regionField, valueField, featureNameProperty, featureValueProperty, classification, colorRamp, noDataColor, valueLabel, fitPadding, dark, basemap }) {
  const cfg = { regionField, valueField: valueField || null, featureNameProperty, featureValueProperty: featureValueProperty || null, classification, colorRamp, noDataColor, valueLabel, fitPadding, dark, basemap, regionAliases: REGION_ALIASES, regionCodeFields: REGION_CODE_FIELDS, featureCodeFields: FEATURE_CODE_FIELDS };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readBundledAsset(new URL("leaflet.css", import.meta.url), "utf8")}</style><style>
  *{box-sizing:border-box}html,body{height:100%;width:100%;margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${dark?"#111827":"#fff"};color:${dark?"#f9fafb":"#1f2937"}}.shell{height:100%;min-height:360px;display:flex;flex-direction:column}.title{font-size:15px;font-weight:650;padding:12px 16px;border-bottom:1px solid ${dark?"#374151":"#e5e7eb"}}#map{flex:1;min-height:300px;background:${dark?"#18212f":"#f8fafc"}}.legend{background:${dark?"rgba(17,24,39,.94)":"rgba(255,255,255,.96)"};color:${dark?"#f9fafb":"#1f2937"};padding:10px 12px;border-radius:8px;box-shadow:0 1px 8px #0002;font-size:12px;line-height:1.5;min-width:130px}.legend-title{font-weight:650;margin-bottom:5px}.legend-row{display:flex;align-items:center;gap:7px;white-space:nowrap}.swatch{display:inline-block;width:14px;height:10px;border:1px solid #64748b55}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:${dark?"#1f2937":"#fff"};color:${dark?"#f9fafb":"#1f2937"}}.popup-title{font-weight:650;margin-bottom:5px}.popup-row{display:flex;gap:10px;margin-top:3px;font-size:12px}.popup-key{color:${dark?"#9ca3af":"#64748b"}}
  </style></head><body><div class="shell"><div class="title">${esc(title)}</div><div id="map" aria-label="Interactive regional choropleth map"></div></div><script>${readBundledAsset(new URL("leaflet.js", import.meta.url), "utf8").replaceAll("</script", "<\\/script")}</script><script>
  const geojson=${jsonForScript(geojson)}; const rows=${jsonForScript(rows)}; const cfg=${jsonForScript(cfg)};
  const mapRoot=document.getElementById('map');
  if(!window.L){mapRoot.textContent='Leaflet resource failed to load.';throw new Error('Leaflet resource failed to load');}
  const map=L.map('map',{zoomControl:true,scrollWheelZoom:true,attributionControl:true});
  if(cfg.basemap==='amap'){
    const notice=L.control({position:'bottomleft'});
    let noticeElement;
    notice.onAdd=()=>{noticeElement=L.DomUtil.create('div','legend');noticeElement.setAttribute('role','status');noticeElement.textContent='底图暂不可用，仍可查看区域数据';return noticeElement};
    const tiles=L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',{subdomains:'1234',maxZoom:18,attribution:'底图 &copy; 高德地图',referrerPolicy:'no-referrer'});
    const failedTiles=new Set();
    tiles.on('tileerror',e=>{failedTiles.add(e.tile);notice.addTo(map)});
    tiles.on('tileload',e=>{failedTiles.delete(e.tile);if(!failedTiles.size)notice.remove()});
    tiles.on('tileunload',e=>{failedTiles.delete(e.tile);if(!failedTiles.size)notice.remove()});
    tiles.addTo(map);
  }
  const aliases=cfg.regionAliases||{}; const codeFields=cfg.regionCodeFields||[]; const featureCodeFields=cfg.featureCodeFields||[];
  const norm=v=>{const raw=String(v??'').trim().toLocaleLowerCase().replace(/[\s\u3000]/g,'');return aliases[raw]||raw};
  const rowKeys=row=>{const keys=[];const add=v=>{const k=norm(v);if(k&&!keys.includes(k))keys.push(k)};for(const f of codeFields)add(row[f]);add(row[cfg.regionField]);return keys};
  const featureKeys=feature=>{const p=feature&&feature.properties||{};const keys=[];const add=v=>{const k=norm(v);if(k&&!keys.includes(k))keys.push(k)};for(const f of featureCodeFields)add(p[f]);add(p[cfg.featureNameProperty]);for(const f of ['name','fullname','fullName','NAME','name_zh','province','region','行政区','省份'])add(p[f]);return keys};
  const rowMap=new Map(); const duplicateRows=[];
  for(const row of rows){const keys=rowKeys(row);if(!keys.length)continue;if(keys.some(k=>rowMap.has(k))){duplicateRows.push(keys[0]);continue;}for(const key of keys)rowMap.set(key,row)}
  const featureName=(feature)=>{const p=feature&&feature.properties||{};return p[cfg.featureNameProperty]??p.name??p.fullname??p.NAME??p.adcode??p.code??'Unnamed region'};
  const findRowForFeature=feature=>{for(const key of featureKeys(feature)){if(rowMap.has(key))return rowMap.get(key)}return undefined};
  const featureValue=(feature)=>{const p=feature&&feature.properties||{};const row=findRowForFeature(feature);if(row&&cfg.valueField)return toNum(row[cfg.valueField]);if(cfg.featureValueProperty&&p[cfg.featureValueProperty]!==undefined)return toNum(p[cfg.featureValueProperty]);if(!cfg.valueField){for(const k of ['value','count','amount','metric']){if(p[k]!==undefined){const n=toNum(p[k]);if(n!==undefined)return n}}}return undefined};
  const features=(geojson.features||[]).filter(f=>f&&f.geometry&&['Polygon','MultiPolygon'].includes(f.geometry.type));
  const values=features.map(featureValue).filter(v=>v!==undefined).sort((a,b)=>a-b);
  const breaks=makeBreaks(values,cfg.classification,cfg.colorRamp.length);
  function color(v){if(v===undefined)return cfg.noDataColor;if(!values.length)return cfg.noDataColor;if(cfg.classification==='linear'){const min=values[0],max=values[values.length-1];if(min===max)return cfg.colorRamp[Math.floor(cfg.colorRamp.length/2)];const t=(v-min)/(max-min);return cfg.colorRamp[Math.min(cfg.colorRamp.length-1,Math.max(0,Math.floor(t*cfg.colorRamp.length)))];}let i=breaks.findIndex(b=>v<=b);if(i<0)i=cfg.colorRamp.length-1;return cfg.colorRamp[Math.min(i,cfg.colorRamp.length-1)];}
  function style(feature){const v=featureValue(feature);return {fillColor:color(v),weight:1,color:cfg.dark?'#9ca3af':'#ffffff',opacity:1,fillOpacity:v===undefined?.38:.82};}
  function makePopup(feature){const p=feature.properties||{};const wrap=document.createElement('div');const h=document.createElement('div');h.className='popup-title';h.textContent=String(featureName(feature));wrap.appendChild(h);const add=(k,v)=>{const row=document.createElement('div');row.className='popup-row';const key=document.createElement('span');key.className='popup-key';key.textContent=k;const val=document.createElement('span');val.textContent=v===undefined||v===null?'No data':String(v);row.append(key,val);wrap.appendChild(row)};const v=featureValue(feature);add(cfg.valueLabel,v===undefined?'No data':fmt(v));for(const [k,val] of Object.entries(p)){if(k===cfg.featureNameProperty||k==='name'||k==='NAME'||k===cfg.featureValueProperty||k==='geometry'||val===null||typeof val==='object')continue;if(k===cfg.valueField)continue;add(k,val)}return wrap;}
  const layer=L.geoJSON({type:'FeatureCollection',features},{style,onEachFeature:(feature,featureLayer)=>{featureLayer.bindPopup(makePopup(feature));featureLayer.on({mouseover:e=>{e.target.setStyle({weight:2,color:cfg.dark?'#f9fafb':'#334155',fillOpacity:.95});if(!L.Browser.ie&&!L.Browser.opera&&!L.Browser.edge)e.target.bringToFront()},mouseout:e=>layer.resetStyle(e.target),click:e=>{if(e.target.getBounds)e.target.getBounds().isValid()&&map.fitBounds(e.target.getBounds(),{maxZoom:8})}})}}).addTo(map);
  if(layer.getLayers().length){const bounds=layer.getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[cfg.fitPadding,cfg.fitPadding]});}else map.setView([20,0],2);
  const legend=L.control({position:'bottomright'});legend.onAdd=()=>{const div=L.DomUtil.create('div','legend');const h=L.DomUtil.create('div','legend-title',div);h.textContent=cfg.valueLabel;const min=values.length?values[0]:undefined,max=values.length?values[values.length-1]:undefined;for(let i=cfg.colorRamp.length-1;i>=0;i--){const row=L.DomUtil.create('div','legend-row',div);const sw=L.DomUtil.create('span','swatch',row);sw.style.background=cfg.colorRamp[i];const label=L.DomUtil.create('span','',row);label.textContent=legendLabel(i,breaks,min,max,cfg.colorRamp.length,cfg.classification)}const nd=L.DomUtil.create('div','legend-row',div);const sw=L.DomUtil.create('span','swatch',nd);sw.style.background=cfg.noDataColor;const label=L.DomUtil.create('span','',nd);label.textContent='No data';L.DomEvent.disableClickPropagation(div);return div};legend.addTo(map);
  function toNum(v){if(v===null||v===undefined||String(v).trim()==='')return undefined;const n=typeof v==='number'?v:Number(String(v).replace(/,/g,'').trim());return Number.isFinite(n)?n:undefined}function fmt(v){return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(v)}
  function makeBreaks(vals,method,n){if(!vals.length)return[];const min=vals[0],max=vals[vals.length-1];if(method==='equal-interval'){return Array.from({length:n},(_,i)=>min+(max-min)*(i+1)/n)}if(method==='linear')return Array.from({length:n},(_,i)=>min+(max-min)*(i+1)/n);return Array.from({length:n},(_,i)=>vals[Math.min(vals.length-1,Math.ceil((i+1)*vals.length/n)-1)])}
  function legendLabel(i,bounds,min,max,n,method){if(min===undefined)return 'No values';if(method==='linear'){const lo=i===0?min:bounds[i-1],hi=bounds[i];return fmt(lo)+' – '+fmt(hi)}const lo=i===0?min:bounds[i-1],hi=bounds[i];return fmt(lo)+' – '+fmt(hi)}
  new ResizeObserver(()=>map.invalidateSize()).observe(mapRoot);
  </script></body></html>`;
}
export async function execute(input) {
  const chartType = input?.chartType || "admin-choropleth-map";
  const title = String(input?.title || "Regional Distribution").trim();
  if (chartType !== "admin-choropleth-map") return errorResult("admin-choropleth-map only supports chartType: admin-choropleth-map", { chartType });
  const dataRoot = input?.data;
  const rows = Array.isArray(dataRoot) ? dataRoot.filter(r=>r&&typeof r==='object') : Array.isArray(dataRoot?.regions) ? dataRoot.regions.filter(r=>r&&typeof r==='object') : [];
  if (!rows.length) return errorResult("Missing or empty region statistics: data must be an array or { regions: [...] }");
  let resolved;
  try { resolved = await resolveGeoJSON(input, dataRoot); }
  catch (error) { return errorResult(`Invalid supplied GeoJSON: ${String(error?.message || error)}`, { missingParams:["geojson"] }); }
  const geojson = resolved?.geojson;
  if (!geojson || !isPolygonFeatureCollection(geojson)) {
    const reason = resolved?.loadError ? ` Automatic boundary loading failed: ${resolved.loadError}. Run node scripts/fetch-boundaries.mjs with network access, or pass input.geojson.` : " Provide input.geojson or use boundarySet: 'china-provinces'.";
    return errorResult("Missing or invalid geojson: no bundled or downloadable China province polygon FeatureCollection was found." + reason, { missingParams:["geojson"], boundarySet:input?.boundarySet || "china-provinces", boundarySource:resolved?.source || null });
  }
  const regionField = findField(rows,input?.regionField,REGION_FIELDS);
  if (!regionField) return errorResult("Unable to identify the region field; set regionField explicitly", { missingParams:["regionField"] });
  const featureProps = geojson.features.find(f=>f&&f.properties)?.properties || {};
  const featureNameProperty = input?.featureNameProperty && Object.prototype.hasOwnProperty.call(featureProps,input.featureNameProperty) ? input.featureNameProperty : FEATURE_NAME_FIELDS.find(k=>Object.prototype.hasOwnProperty.call(featureProps,k));
  if (!featureNameProperty) return errorResult("Unable to identify a region name/code property in GeoJSON; set featureNameProperty explicitly", { missingParams:["featureNameProperty"] });
  const valueField = input?.valueField && rows.some(r=>Object.prototype.hasOwnProperty.call(r,input.valueField)) ? input.valueField : undefined;
  const featureValueProperty = input?.featureValueProperty && Object.prototype.hasOwnProperty.call(featureProps,input.featureValueProperty) ? input.featureValueProperty : undefined;
  if (!valueField && !featureValueProperty && !["value","count","amount","metric"].some(k=>Object.prototype.hasOwnProperty.call(featureProps,k))) return errorResult("Missing valueField: set a numeric metric field or provide featureValueProperty", { missingParams:["valueField"] });
  const validGeoFeatures = geojson.features.filter(f=>f&&f.geometry&&["Polygon","MultiPolygon"].includes(f.geometry.type));
  if (!validGeoFeatures.length) return errorResult("GeoJSON contains no Polygon or MultiPolygon features");
  const rowMap = new Map(); const warnings = []; let duplicateRows = 0; const rowKeySets = [];
  for (const row of rows) {
    const keys = regionKeysFromRow(row, regionField);
    if (!keys.length) continue;
    if (keys.some(key => rowMap.has(key))) { duplicateRows++; continue; }
    rowKeySets.push(new Set(keys));
    for (const key of keys) rowMap.set(key, row);
  }
  if (duplicateRows) warnings.push(`${duplicateRows} duplicate region row(s) ignored; first row was used`);
  const featureKeySets = validGeoFeatures.map(f => new Set(regionKeysFromFeature(f, featureNameProperty)));
  const allFeatureKeys = new Set(featureKeySets.flatMap(set => [...set]));
  let matchedRegions=0, unmatchedRegions=0, missingValueRegions=0;
  for (let i=0;i<validGeoFeatures.length;i++) {
    const f = validGeoFeatures[i];
    const row = [...featureKeySets[i]].map(key => rowMap.get(key)).find(Boolean);
    if (row) { matchedRegions++; const v=valueField?numeric(row[valueField]):numeric(f.properties?.[featureValueProperty] ?? f.properties?.value ?? f.properties?.count ?? f.properties?.amount ?? f.properties?.metric); if(v===undefined)missingValueRegions++; }
    else { unmatchedRegions++; }
  }
  const unmatchedDataRows = rowKeySets.filter(keys => ![...keys].some(key => allFeatureKeys.has(key))).length;
  if(unmatchedRegions)warnings.push(`${unmatchedRegions} GeoJSON region(s) have no matching statistic row`);
  if(unmatchedDataRows)warnings.push(`${unmatchedDataRows} statistic row(s) did not match any GeoJSON feature`);
  if(missingValueRegions)warnings.push(`${missingValueRegions} matched region(s) have missing or non-numeric values`);
  if (resolved.source?.startsWith("remote:")) warnings.push("Province boundaries were loaded from the remote source; for offline deployment, run scripts/fetch-boundaries.mjs and include data/geojson/china-provinces.geojson in the Skill package.");
  const ramp = Array.isArray(input.colorRamp) && input.colorRamp.length>=3 ? input.colorRamp.slice(0,9).map(String) : DEFAULT_RAMP;
  const classification = ["quantile","equal-interval","linear"].includes(input.classification) ? input.classification : "quantile";
  const noDataColor = typeof input.noDataColor === "string" ? input.noDataColor : "#d1d5db";
  const valueLabel = String(input.valueLabel || valueField || featureValueProperty || "Value");
  const safeGeoJSON = { type:"FeatureCollection", features:validGeoFeatures };
  const html = generateHtml({ title, geojson:safeGeoJSON, rows, regionField, valueField, featureNameProperty, featureValueProperty, classification, colorRamp:ramp, noDataColor, valueLabel, fitPadding:Math.max(8,Math.min(100,Number(input.fitPadding)||24)), dark:input.theme === "dark", basemap:input.basemap === 'none' || (resolved.source === 'input' && input.basemap !== 'amap') ? 'none' : 'amap' });
  return { html, meta:{ skillId:"admin-choropleth-map", chartType, title, dataRows:rows.length, geojsonFeatures:validGeoFeatures.length, matchedRegions, unmatchedRegions, unmatchedDataRows, missingValueRegions, regionField, valueField:valueField||null, featureNameProperty, classification, boundarySet:input?.boundarySet || "china-provinces", boundarySource:resolved.source || null, boundaryCoordinateSystem:"GCJ-02 (source dataset v1.6.3)", warnings } };
}


// The exported calculation/rendering function is also usable as an ordinary CLI.
if (import.meta.main) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const source = process.argv[2]?.replace(/^@/, "");
  if (!source) throw new Error("Expected a JSON input file");
  const result = await execute(JSON.parse(await fs.readFile(source, "utf8")));
  if (result.meta?.error || result.json?.success === false)
    throw new Error(result.json?.error || "Skill could not produce the requested result");
  const root = process.env.ONTOMATO_OUTPUT_DIR || "outputs";
  const output = path.join(root, "admin-choropleth-map." + (result.html ? "html" : "json"));
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir("work", { recursive: true });
  const temporary = path.join("work", randomUUID() + ".tmp");
  try {
    await fs.writeFile(temporary, result.html ?? JSON.stringify(result.json ?? result, null, 2));
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { force: true }); }
  if (result.meta) console.log(JSON.stringify(result.meta));
  console.log(path.relative(process.cwd(), path.resolve(output)));
}
