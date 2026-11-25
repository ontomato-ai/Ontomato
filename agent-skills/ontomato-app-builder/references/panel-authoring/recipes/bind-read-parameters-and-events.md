# Bind read parameters and listen to component events

Inspect each component's Data and Events sections in its single page (`sdk read docs/components/<ComponentId>.md`, listed in `sdk read docs/components.md`) and read parameter signatures in
`panel type <type-id> --read <name>`. Explicit `data.<name>.params` map read parameters to `{ state: "fieldName" }`,
`{ literal: value }`, or `{ fromSlot: true }`, or bind a same-named read parameter via the member's `state` map.
Components supply their own runtime parameters (such as search/page/cursor) automatically when unbound.

Listen to component events directly on `<projection>` (`@choose`, `@navigate`, `@saved`, `@discarded`, `@done`).

### Server field filters and sorting on customer `ObjectType` lists (`query`)

Customer ontology `query` reads
  (and `platform:ObjectType.instances`) accept optional `filters` (`recordFilters`) and `sort` (`recordSort`)
  parameters executed server-side across the whole class before counting `total` and paging (the viewer must have read
  permission on every referenced field):
  - `filters`: JSON array of `{ field, operator, value? }` combined with logical **AND**. Supported `operator` values
    are `"eq"`, `"ne"`, `"contains"` (string `value` required), `"gt"`, `"lt"`, `"gte"`, `"lte"`, `"null"`, and
    `"notnull"` (`"null"` and `"notnull"` forbid `value`; all other operators require scalar `string | number | boolean`
    `value`).
  - `sort`: JSON object `{ field, order: "asc" | "desc" }` (the class primary key is appended as a stable tie-breaker).
  - Declare `filters` and/or `sort` in `manifest.state` as `{ "type": { "kind": "json" }, "default": null }` (`null`
    omits the parameter), bind them under `data.rows.params`, and put filter/sort controls in `<template #filters>` (clear
    both in `@clear-filters` as well). `ObjectList` automatically resets to page 1 when `filters` or `sort` changes.

```json
{
  "manifest": {
    "state": {
      "selected": { "type": { "kind": "object", "objectType": "WorkItem" }, "deepLink": true },
      "search": { "type": { "kind": "scalar", "type": "string" }, "default": "", "deepLink": true },
      "listFilters": { "type": { "kind": "json" }, "default": null },
      "listSort": { "type": { "kind": "json" }, "default": null }
    },
    "members": {
      "list": {
        "component": "ObjectList",
        "type": "WorkItem",
        "data": {
          "rows": {
            "read": "query",
            "params": {
              "filters": { "state": "listFilters" },
              "sort": { "state": "listSort" }
            }
          }
        },
        "state": { "selected": "selected", "search": "search" },
        "config": { "layout": "table", "pagination": "pages", "pageSize": 20 }
      }
    }
  }
}
```

Example values written to `listFilters` and `listSort`:

```js
instance.state.setState("listFilters", [
  { field: "category", operator: "eq", value: "teaching" },
  { field: "status", operator: "ne", value: "archived" },
]);
instance.state.setState("listSort", { field: "updated_at", order: "desc" });
// Clear filters / sort:
instance.state.setState("listFilters", null);
instance.state.setState("listSort", null);
```
