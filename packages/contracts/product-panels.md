# Current panel reads

With an empty query, `GET /api/product-panels/:id` returns `{ panel }` and `GET /api/product-panels/:id/snapshot` returns `{ panel, projections }` with their definition revisions, under the existing read rules.

Both GETs use `productPanelReadQuerySchema`. An application-use read sends `applicationId`, `useId` and `pageKey` along with either `permissionCode` or `access=domain-member`. Partial or mixed context queries receive HTTP 400. Either response can carry `pageSkillContext` alongside `panel`, using `pageSkillContextSchema` from `page-skills`. When reopening a retained panel frame, use the fresh context from the snapshot response even when the definition revisions match.

During the same read, the server uses the initiator's credentials to verify the actual application, use and entrance through their existing owner. The owner's admission decision establishes access. The server compares the resolved use's panel ID with the `panel.id` of the record it reads solely to tie the context to that snapshot. If the use now points to another panel, return the verified entrance's member context with `member: null`.
