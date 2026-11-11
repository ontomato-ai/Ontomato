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
- `POST /platform/applications/connected`: register or update a connected application.

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

## Connected applications

Registration is an API operation; there is no registration page. Both editions use
`POST <P>/api/data-query/platform/applications/connected`, where `<P>` is the deployment
prefix (empty by default), with this body:

```json
{
  "id": "app-reporting",
  "declaration": {
    "names": {"en": "Reporting"}, "descriptions": {}, "icon": "pages",
    "groups": [], "permissions": []
  },
  "upstream": "http://reporting:8080",
  "upstreamPrefix": "/"
}
```

Use the same ID and endpoint to update an application. Response data is
`{applicationId, releaseId: null, entryPath}`. The catalog owns the application and
its connection fields in `sys_application.entry`; there is no separate connection
table. Existing connected applications keep their data and grants when upgrading.

Configure allowed origins per domain in the deployment `.env`, passed to the data
engine by Compose's `env_file`:

```dotenv
ONTOMATO_APP_UPSTREAMS='{"1":["http://reporting:8080","https://reports.example.com:443"]}'
```

Open source uses domain `1`; enterprise uses the actual domain IDs. Each allowed
origin names a trusted application server with a scheme, host and explicit port.
The submitted `upstream` must match an entry exactly. The default `{}` permits no
registration. Recreate the `datarag` container after changing this environment value.
`upstreamPrefix` is `/` or a slash-terminated sequence of path segments containing
letters, digits, underscores or hyphens, for example `/reports/`.

Open source permits all visitors to register, maintain and open applications, using
the same anonymous single-domain identity as its other applications. Enterprise
requires the registration API permission for both creation and updates; it is
available to administrators by default. Updates additionally require the owner or
a domain administrator. The first registration grants the entry directly to its
owner; administrators can also enter through their existing menu permissions.

The gateway forwards `/apps/<id>/<tail>` to the registered origin and
`upstreamPrefix + tail`, preserving the query string. It sends
`X-Forwarded-Prefix: <P>/apps/<id>` and forwards tk/API Key headers. The trusted
application handles its own subpath resources and redirects. Its backend obtains
the caller's identity from the platform rather than accepting a user or domain
claimed by the browser:

- **Enterprise:** call `POST <P>/api/auth/verify` with the caller's `tk` header or
  `{ "tk": "..." }` body. The response contains the user identified by that login
  credential. API Key callers use the existing enterprise-only
  `POST <P>/api/auth/verifyByApiKey` endpoint instead.
- **Open source:** call `POST <P>/api/auth/verify` without credentials. It always
  returns the anonymous single-domain identity, even if a credential is supplied:
  `data.id = "admin"`, `data.loginCode = "admin"`, `data.userName = "admin"`,
  `data.domainId = "1"`. Only `/api/auth/verify` is implemented for identity
  verification in this edition; `/api/auth/verifyByApiKey` is not available.

Both verify responses use the existing `R` envelope (`success: true`, `code: 200`,
`data: <user>` on success). The identity field is **`data.id`**, not `data.userId`.
