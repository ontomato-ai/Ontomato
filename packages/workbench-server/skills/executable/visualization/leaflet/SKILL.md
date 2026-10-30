---
name: leaflet
description: Interactive Leaflet base map for geospatial points with value-scaled markers and detail popups.
type: executable
category: visualization
title: Leaflet Base Map
tags:
  - visualization
  - map
  - leaflet
  - geospatial
timeout: 15000
outputType: html
version: 1.0.0
defaultEnabled: false
entries:
  - scripts/index.mjs
---
## Leaflet Base Map

Render tabular data with latitude and longitude fields as an interactive Leaflet point map. The skill adapts to light and dark themes automatically and shows a zoomable base map, circle markers, and detail popups.

## Input Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| data | Yes | Array of data rows. Each row must be an object. |
| chartType | Yes | Must be `leaflet-map`. |
| title | Yes | Map title. |
| latitudeField | No | Latitude field name. If omitted, the skill auto-detects common names such as `latitude`, `lat`, and some localized variants. |
| longitudeField | No | Longitude field name. If omitted, the skill auto-detects common names such as `longitude`, `lng`, `lon`, and some localized variants. |
| labelField | No | Label field for each point. If omitted, the skill auto-detects common names such as `name`, `location`, and some localized variants. |
| valueField | No | Numeric field used for marker radius scaling and popup display. |
| showTitle | No | Set to `false` when the host card already displays a title. |
| locale | No | Host interface language, used for map controls and resource errors. |

## Configuration Rules

- Use this skill only when each usable row can provide valid latitude and longitude values. Latitude must be between -90 and 90, and longitude must be between -180 and 180.
- Prefer explicit `latitudeField` and `longitudeField` values that match the real data fields. Rely on auto-detection only when the field names follow common naming conventions.
- `labelField` should point to a readable location name such as a site, store, project, device, or administrative region.
- `valueField` can be a numeric metric such as headcount, revenue, or quantity. Marker radius is scaled by relative value size.
- Do not use this skill for province- or city-level aggregate data without coordinates. That kind of data should use an administrative boundary map skill instead.
- Coordinates use WGS-84 with the Esri World Topographic basemap. Browser network access to `server.arcgisonline.com` is required. Markers and popups inherit host theme tokens from the embedding frame; the tile pane adapts to the host background's light/dark mode.

## Example

Input data:

```json
[
  {"storeName": "Shanghai Xuhui Store", "latitude": 31.188, "longitude": 121.436, "sales": 128000},
  {"storeName": "Shanghai Pudong Store", "latitude": 31.230, "longitude": 121.544, "sales": 186000}
]
```

Recommended configuration:

```json
{
  "chartType": "leaflet-map",
  "title": "Shanghai Store Sales Distribution",
  "latitudeField": "latitude",
  "longitudeField": "longitude",
  "labelField": "storeName",
  "valueField": "sales"
}
```

## Output Format

```json
{
  "html": "Fully rendered HTML page",
  "meta": {
    "skillId": "leaflet",
    "chartType": "leaflet-map",
    "title": "Map title",
    "dataRows": 2,
    "skippedRows": 0
  }
}
```
