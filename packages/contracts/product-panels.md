# Current panel reads

`GET /api/product-panels/:id` returns `{ panel }` under the existing panel read rules when the query is empty.

An application-use read sends `applicationId`, `useId` and `pageKey` along with either `permissionCode` or `access=domain-member`. Partial or mixed context queries receive HTTP 400. The response can carry `pageSkillContext` alongside `panel`, using `pageSkillContextSchema` from `page-skills`.

During the same read, the server uses the initiator's credentials to verify the actual application, use and entrance through their existing owner. The owner's admission decision establishes access. The server compares the resolved use's panel ID with the `panel.id` of the record it reads solely to tie the context to that snapshot. If the use now points to another panel, return the verified entrance's member context with `member: null`.
