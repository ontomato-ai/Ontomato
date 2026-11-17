# China province boundaries (WGS-84)

The platform's bundled province boundary resource, registered as `china-provinces` (`chartMapResources`).

- Data: GeoJSON.CN's China administrative boundary dataset, version 1.6.3 (released 2025-12-14), dataset page
  <https://geojson.cn/data/atlas/china>, default endpoint <https://geojson.cn/api/china/1.6.3/100000.json>.
  Copyright (c) 2025 GeoJSON.CN, <https://geojson.cn>. Review the provider's terms and the applicable map and data
  regulations before redistribution or commercial use; the boundaries are for statistical visualization, not legal
  boundary determination, navigation or surveying.
- Original coordinate system: GCJ-02, as the source documents it.
- Conversion to WGS-84: one-time, offline, before this file was committed. Every vertex and every feature centre was
  converted by inverting the standard GCJ-02 offset iteratively (WGS-84 → GCJ-02 forward transform, then
  `wgs = gcj - (forward(wgs) - gcj)` until the offset is below 1e-9°, at most 20 rounds). Coordinates outside China's
  GCJ-02 area were left unchanged. The conversion script is not part of this repository; no runtime conversion happens
  in the browser or in filling.
- Precision: converting each vertex back to GCJ-02 reproduces the source within 5.3e-7 m (0.0005 mm) over all 14324
  vertices; feature centres round-trip within 2.5e-7 m. Coordinates are stored with 6 decimals (about 0.11 m), and
  rounding moves a feature centre by at most 4.9e-7°.
- Coordinate system in use: WGS-84. Chart points (`leaflet-map`, `map`) are WGS-84 as well, so no runtime offset is
  applied when they are drawn over these boundaries.

Only these provinces are bundled. A region absent from this file has no resource: a chart that asks for it reports the
missing resource instead of fetching or falling back to another source. Street-level boundaries are not bundled.
