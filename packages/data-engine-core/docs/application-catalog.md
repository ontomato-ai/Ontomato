# Application catalog

Java owns application identity and navigation metadata. Bundled declarations live in
`resources/applications/*.json` and in the workbench's `services/applications/builtins.ts`.
The workbench submits `{applications: [...]}` to
`POST /platform/applications/self/declarations` with the existing
`X-Ontomato-Query-Service-Token`; the response data contains `serviceId` and `applicationIds`.
Application pages and scheduling implementations remain with their owning modules.

Browser calls use `/api/data-query` before the Java paths below. Responses use the
existing `R` envelope except the gateway check and cookie endpoints.

- `GET /platform/applications`: applications authorized by their declared entry permissions.
- `GET /platform/applications?purpose=schedules`: scheduling application metadata in the current domain.
- `GET /platform/applications/{id}`: application metadata in the current domain.
- `PUT /platform/applications/{id}/hosted-publication`: publish or replace the reference.

Publication body:

```json
{
  "declaration": {
    "names": {"en": "Example"},
    "descriptions": {},
    "icon": "pages",
    "groups": [],
    "permissions": []
  },
  "releaseId": "release-123"
}
```

The workbench supplies its stable `app-...` ID and the user's tk or API Key. Java
checks domain, kind and author/administrator ownership. First publication creates
`app:<id>:entry` and grants it directly to the author in enterprise. Later publications
preserve grants. Response data is `{applicationId, releaseId, entryPath}`.
Permission declarations use `{code, names, groupKey, sort}` and groups use
`{key, names, sort}`; user permission codes must begin with `app:<id>:`.

`GET /internal/app-entry` receives `X-App-Credential`, `X-App-Request-Uri` and
`X-Forwarded-Prefix` from the gateway. It returns 204 and `X-App-Route-Kind`,
`X-App-Proxy-Path`, and, for connected applications, `X-App-Upstream`.
Hosted paths are `/internal/hosted-apps/<appId>/<releaseId>/<path>` with the original
query appended once. The gateway proxies these to the workbench. No version is
added to the browser URL; a publication switch may require refreshing an open page.
The open-source assembly uses its existing anonymous identity.

`entryAccess` is an array of alternative existing menu codes. `["domain-member"]`
means every member of the current domain. The same enterprise policy filters all
application kinds and checks gateway requests; the browser uses that returned list.
Ontology entry includes modeling, actions, knowledge, skills and MCP permissions;
capability-library navigation requires `skill-management` or `mcp-service`.
Grouping-only codes such as `intelligence-engine` and `system-management` do not
open a page by themselves and are not entry alternatives. Native layout code only
chooses the first accessible page within an application already returned by Java.
