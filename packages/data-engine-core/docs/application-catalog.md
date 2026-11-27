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


## Domain application editing

The catalogue supplies the registered application's domain, ID, `owner_user_id`
and `coauthor_ids` to the application EDIT decision. Registered applications
are published definitions. An absent author stays absent. Entry admission
uses the separate ENTRY decision.

The catalogue shows an application to a user who can enter at least one of
its entries or edit the application. The EDIT decision sets `canMaintain`.
Entry navigation uses only entry decisions. Workbench checks each panel and
frame when it reads their definitions. During application registration,
Workbench also checks that the registrant can use the declared root panels
and frame.
Legacy release writers check `/platform/applications/{id}/legacy-maintenance`
before modifying a registered application. Their own bundle and asset checks
still apply. The generic legacy grant writers also ask the catalogue about a
registered application before changing same-ID legacy grants.

### Development data cutover evidence

Inventory `product_grant` before deployment by joining both identifiers to a
registered application. The source key contains no provenance or creation time.

```sql
SELECT a.domain_id, a.id, a.kind, a.entry->>'renderer' AS renderer,
       a.owner_user_id, g.principal_kind, g.principal_id
FROM sys_application a
JOIN product_grant g ON g.domain_id = a.domain_id AND g.resource_id = a.id
WHERE a.domain_id IS NOT NULL AND a.kind IS NOT NULL AND g.verb = 'edit'
ORDER BY a.domain_id, a.id, g.principal_kind, g.principal_id;
```

- The enterprise declaration and older Java application import seeded principal
  EDIT for the author and role EDIT for the actual administrator roles. The
  product grant key also held explicit grants. A principal row matching the
  recorded author needs no new grant, and its source remains unknown.
- Add confirmed, existing domain members with an explicit personal EDIT grant
  to that application's `coauthor_ids`. A differing principal ID is a
  candidate only. Check the recorded author history, legacy asset ownership if a
  bundle shares the ID, and the edition's identity mapping. The OSS legacy
  product principal is `system` while the Java anonymous subject is `admin`.
  Neither an alias nor an EDIT row establishes authorship. Leave unresolved
  principal rows and missing authors on the review list.
- Carry EDIT for valid roles to an object policy assigned to exactly those roles,
  scoped to this application, and domain-wide EDIT to the domain member
  policy if the source really granted it. Existing admin-role EDIT is an
  explicit migration input by role ID. Neither admin status, role name, menu
  access nor USE supplies an EDIT grant. Check the role and policy domain and
  their recipients before adding the grant.
- Apply from the reviewed snapshot before enabling the new writer. Merge
  coauthor IDs as a set and insert EDIT grants by the existing policy grant
  key, so applying the same snapshot twice gives the same result. A later run
  must not restore a coauthor or policy grant intentionally revoked after
  cutover. Preserve USE rows and retain unresolved rows for the step 4 review.

The schema change only adds the coauthor fact. The development data inventory
and cutover are operator work. Demotion or deletion of legacy rows belongs to
the subsequent cleanup.

Every panel use, native entry and frame conversation entry requires localized `names`.
Entries appear in the application menu by default. Set `inMenu: false` to hide an entry from the menu.
