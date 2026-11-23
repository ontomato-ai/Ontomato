# Application detail — agent recipes

This non-menu detail page inspects and maintains one `platform:Application` at `/ontology/applications/detail`.

## Public states

- `selected`: the `platform:Application` being inspected (`deepLink: true`).
- `tab`: `"identity"` (basics, standalone toggle & copyable external link), `"entries"` (navigation entries, frame panel & theme overrides), `"assets"` (used panels & projections), or `"grants"` (domain sharing & explicit grants, when `canGrant`).
- `entriesView`: `"list"` (entry table) or `"bulk"` (full-table `entriesForm` editor).
- `editingEntryId`: `"__new__"` or an existing entry ID to open the single-entry `entryForm` dialog.
- `inspectedPanel`: the `platform:ProductPanel` selected in the Panels & Projections tab.
- `grantDialog` / `grantPrincipalKind` / `userKeyword` / `roleKeyword`: add-grant dialog state and member/role search filters.

## Common flows

1. **Edit identity or toggle standalone opening (`allowStandalone`)**:
   - Open with `tab: "identity"` and draft `platform:Application.save` targeting `save`.
   - When `allowStandalone` is enabled, `runtimeSummary` / `summary` exposes the copyable `externalLink`; disabling `allowStandalone` hides `externalLink`.
2. **Add or edit an entry**:
   - Draft `platform:Application.save` targeting `entryForm` (single entry) or `entriesForm` (bulk table).
3. **Delete an application**:
   - Invoke `applications.delete` on the selected `platform:Application` (requires confirmation).
4. **Return to the catalogue**:
   - Navigate to `/ontology/applications`.
