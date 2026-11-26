# Current panel reads

With an empty query, `GET /api/product-panels/:id` returns `{ panel }` and `GET /api/product-panels/:id/snapshot` returns `{ panel, projections }` with their definition revisions, under the existing read rules.

Opening an application entry uses `GET /api/product-panels/application-entry` with either `path` or `applicationId` + `useId`. The server resolves and admits the entry through its owner and returns the entry, menu, frame/theme facts and, for a panel entry, the current page placement in `pageSkillContext`. That placement is only `{applicationId, entryKey, pageKey, useId, panelId, path, memberPath}`; it contains no skill reference.

A content panel read for a registered entry uses `GET /api/product-panels/:id?source=registered&applicationId=…&useId=…`. The server verifies the actual application, use and entrance through their existing owner, requires that the entry still uses the requested panel, and uses the entry's declared inputs when bundling projections. The response contains the panel definition and requested projections, not page placement.

An application frame uses `GET /api/product-panels/:id?applicationId=…&useId=…&source=frame` and the same query on `GET /api/product-panels/:id/snapshot`. For both, the entry must resolve to this frame and the reader must have use access to it. The record returns `{ panel }`, and the snapshot returns the frame and its fixed member revisions. Neither response includes page placement. For member reads, nested placements and personal state in that frame, use `{kind:"frame",applicationId,useId}` as the source.

Human operation requests use the same flat operation reference with `root:"frame"`. Preparation freezes the frame ID and dispatch rechecks the entry, frame and operation.
