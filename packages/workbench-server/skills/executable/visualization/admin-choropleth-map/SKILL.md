---
name: admin-choropleth-map
description: Render interactive choropleth maps for Chinese provincial regions by matching regional statistics to bundled or automatically loaded GeoJSON boundaries. Supports province-name aliases, administrative-code matching, color classification, legends, popups, and missing-data diagnostics.
metadata:
  ontomato.type: executable
  ontomato.category: visualization
  ontomato.title: Administrative Choropleth Map
  ontomato.tags: '["visualization","choropleth","administrative map","geospatial","GeoJSON","Leaflet","China provinces"]'
  ontomato.version: 1.1.1
  ontomato.outputType: html
  ontomato.defaultEnabled: "false"
---

## Standard CLI

Write the documented input to a JSON file and run:

`node skills/admin-choropleth-map/scripts/index.mjs work/input.json`

The command writes its result under `outputs/` and prints the file path.
Reference that path in Markdown. The command runs unchanged in an external harness;
use the package's local path when it is installed somewhere other than `skills/`.


## Administrative Choropleth Map

Render region-level numeric metrics by filling polygon boundaries with colors. The skill supports China's province-level boundary set and retains the `execute(input) -> { html, meta }` contract.

Boundary resolution order:
1. `input.geojson` or `input.data.geojson`, if supplied.
2. Local packaged/cache file `data/geojson/china-provinces.geojson`.
3. Automatic download from the configured GeoJSON.CN province boundary endpoint, then cache locally when the runtime permits filesystem writes.

The archive includes the province boundary payload for offline boundary loading. Run `node scripts/fetch-boundaries.mjs` to refresh it from the documented source.

The default China boundary set displays a GCJ-02 AMap basemap, requiring browser network access to `https://webrd0{s}.is.autonavi.com`. Tile failures show a status message while the choropleth remains usable. Set `basemap: "none"` for a plain offline background. Explicit GeoJSON defaults to no basemap because its coordinate system is unknown; enable `basemap: "amap"` only for compatible GCJ-02 coordinates. Leaflet JS/CSS still use the host resource endpoints.

## Input Parameters

Minimal province-level input (boundary data auto-loads if available):

```json
{
  "chartType": "admin-choropleth-map",
  "title": "各省销售额分布",
  "boundarySet": "china-provinces",
  "data": [
    { "province": "广东", "adcode": "440000", "sales": 260 },
    { "province": "北京", "adcode": "110000", "sales": 120 },
    { "province": "上海市", "adcode": "310000", "sales": 180 }
  ],
  "regionField": "province",
  "valueField": "sales",
  "classification": "quantile",
  "valueLabel": "销售额（万元）"
}
```

If the runtime cannot load the local boundary file or reach the default source, pass `geojson` as a GeoJSON `FeatureCollection`:

```json
{
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": { "name": "广东省", "code": "440000" },
        "geometry": { "type": "Polygon", "coordinates": [] }
      }
    ]
  }
}
```

The empty coordinate array above is a schema illustration only, not renderable geographic data. Real features must contain valid Polygon or MultiPolygon coordinates.

## Parameters

| Parameter | Required | Description |
|---|---|---|
| `data` | Yes | Array of regional statistic rows, or `{ "regions": [...] }`. |
| `geojson` | No | Optional explicit GeoJSON `FeatureCollection`; if omitted, the skill attempts local/remote boundary loading. May also be passed as `data.geojson`. |
| `boundarySet` | No | Defaults to `china-provinces`. The current bundled boundary resolver supports this set. |
| `autoLoadGeoJSON` | No | Defaults to `true`. Set to `false` to disable local/remote auto-loading. |
| `geojsonUrl` | No | Optional override for the remote GeoJSON endpoint. Use a trusted, versioned source. |
| `regionField` | No | Field in statistic rows containing region name or code. Auto-detects common Chinese/English names and codes. |
| `valueField` | Yes unless values are embedded in GeoJSON | Numeric metric used for fill color. |
| `featureNameProperty` | No | Preferred GeoJSON property for the region name/code. Auto-detects `name`, `fullname`, `code`, `adcode`, `gb`, etc. |
| `featureValueProperty` | No | Numeric metric embedded in each GeoJSON feature. |
| `classification` | No | `quantile` (default), `equal-interval`, or `linear`. |
| `colorRamp` | No | Array of 3–9 CSS colors from low to high values. |
| `noDataColor` | No | Color for features without a matched numeric value. |
| `valueLabel` | No | Human-readable metric label for legend and popup. |
| `fitPadding` | No | Map fit padding in pixels; defaults to 24. |
| `basemap` | No | `amap` or `none`; defaults to AMap for built-in boundaries and none for explicit GeoJSON. |
| `theme` | No | Use `dark` for a dark map panel. |

## Matching behavior

- Region names are trimmed, case-normalized, and matched using common Chinese province aliases, including short/full names such as `广东`/`广东省`, `北京`/`北京市`, and `广西`/`广西壮族自治区`.
- The skill also indexes common code fields (`adcode`, `code`, `gb`, `regionCode`, `region_code`, `provinceCode`, `province_code`, `行政区划代码`, and related variants) on both statistics rows and GeoJSON properties. When code and name are both available, either can establish the match.
- Prefer administrative codes when available; names are a fallback. Duplicate statistic rows are not summed automatically; the first row wins and a warning is returned.
- `meta` reports `matchedRegions`, `unmatchedRegions`, `unmatchedDataRows`, `missingValueRegions`, `boundarySource`, and `warnings`.
- The default GeoJSON.CN v1.6.3 dataset documentation identifies its coordinate system as GCJ-02. Do not mix it directly with WGS-84 or CGCS2000 layers without an appropriate coordinate-system decision.
- The skill does not infer geographic shapes from names, and the map does not imply causality. Use a trusted boundary source and check its licensing/terms before redistribution or commercial use.

## Output Format

```json
{
  "html": "Fully rendered HTML page",
  "meta": {
    "skillId": "admin-choropleth-map",
    "chartType": "admin-choropleth-map",
    "matchedRegions": 3,
    "unmatchedRegions": 0,
    "unmatchedDataRows": 0,
    "missingValueRegions": 0,
    "boundarySet": "china-provinces",
    "boundarySource": "bundled:data/geojson/china-provinces.geojson",
    "warnings": []
  }
}
```
