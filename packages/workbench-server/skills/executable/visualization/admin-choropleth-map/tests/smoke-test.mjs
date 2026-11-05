import assert from 'node:assert/strict';
import { execute } from '../scripts/index.mjs';

const geojson = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: '广东省', code: '440000' }, geometry: { type: 'Polygon', coordinates: [[[112, 21], [114, 21], [114, 24], [112, 24], [112, 21]]] } },
    { type: 'Feature', properties: { name: '北京市', code: '110000' }, geometry: { type: 'Polygon', coordinates: [[[116, 39], [117, 39], [117, 41], [116, 41], [116, 39]]] } }
  ]
};

const byAlias = await execute({
  title: 'Province alias smoke test',
  data: [{ province: '广东', sales: 260 }, { province: '北京市', sales: 120 }],
  regionField: 'province', valueField: 'sales', geojson
});
assert.equal(byAlias.meta.error, undefined);
assert.equal(byAlias.meta.matchedRegions, 2);
assert.equal(byAlias.meta.unmatchedDataRows, 0);

const byCode = await execute({
  title: 'Administrative code smoke test',
  data: [{ adcode: '440000', sales: 260 }, { adcode: '110000', sales: 120 }],
  regionField: 'adcode', valueField: 'sales', geojson
});
assert.equal(byCode.meta.matchedRegions, 2);
assert.equal(byCode.meta.unmatchedDataRows, 0);

const missing = await execute({ title: 'Missing boundary test', data: [{ province: '广东', sales: 260 }], autoLoadGeoJSON: false });
assert.equal(missing.meta.error, true);
console.log('Smoke tests passed: province aliases, administrative codes, missing-boundary diagnostics.');
