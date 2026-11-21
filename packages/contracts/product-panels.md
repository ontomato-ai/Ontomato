# Current panel reads

With an empty query, `GET /api/product-panels/:id` returns `{ panel }` and `GET /api/product-panels/:id/snapshot` returns `{ panel, projections }` with their definition revisions, under the existing read rules.

A content read uses the same application-use query for the record and snapshot. It sends `applicationId`, `useId` and `pageKey` along with either `permissionCode` or `access=domain-member`. Partial or mixed context queries receive HTTP 400. Either response can carry `pageSkillContext` alongside `panel`, using `pageSkillContextSchema` from `page-skills`. When reopening a retained panel frame, use the fresh context from the snapshot response even when the definition revisions match.

During the same read, the server uses the initiator's credentials to verify the actual application, use and entrance through their existing owner. The owner's admission decision establishes access. The server compares the resolved use's panel ID with the `panel.id` of the record it reads solely to tie the context to that snapshot. If the use now points to another panel, return the verified entrance's member context with `member: null`.

An application frame uses `GET /api/product-panels/:id?applicationId=…&useId=…&source=frame` and the same query on `GET /api/product-panels/:id/snapshot`. For both, the entry must resolve to this frame and the reader must have use access to it. The record returns `{ panel }`, and the snapshot returns the frame and its fixed member revisions. Neither response includes the content panel's page skill. For member reads, nested placements and personal state in that frame, use `{kind:"frame",applicationId,useId}` as the source.

Human operation requests use the same flat operation reference with `root:"frame"`. Preparation freezes the frame ID and dispatch rechecks the entry, frame and operation.
