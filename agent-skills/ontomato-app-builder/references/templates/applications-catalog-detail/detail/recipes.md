# Application detail — agent recipes

This non-menu detail page inspects and maintains one `platform:Application` at `/ontology/applications/detail`.

## Public states

- `selected`: the `platform:Application` being inspected (`deepLink: true`).
- `tab`: `"identity"` (basics, standalone toggle & copyable external link), `"entries"` (navigation entries table or bulk editor), `"assets"` (used panels & their projections/members), or `"grants"` (domain sharing & explicit grants, when `canGrant`).
- `entriesView`: `"list"` (`entriesList` `ObjectList`) or `"bulk"` (`entriesForm` `ObjectForm`).
- `editingEntryId`: `"__new__"` or an existing entry ID to open the single-entry `entryForm` dialog (public state only, not written to the URL).
- `inspectedPanel`: the `platform:ProductPanel` inspected in the Panels & Projections tab.
- `grantDialog` / `grantPrincipalKind` / `grantUser` / `grantRole` / `grantPrincipalId` / `grantVerb`: add-grant dialog state bound to `userPicker`, `rolePicker`, and `grantSubmit`.

## Common flows

1. **Edit identity or toggle standalone opening (`allowStandalone`)**:
   - Open with `tab: "identity"` and draft `platform:Application.save` targeting `save`.
   - When `allowStandalone` is enabled, `runtimeSummary` / `summary` exposes the copyable `externalLink`; disabling `allowStandalone` hides `externalLink`.
2. **Add, edit, or delete an entry**:
   - Draft `platform:Application.save` targeting `entryForm` (single entry) or `entriesForm` (bulk table), or run `deleteEntry` declared on `entriesList`.
3. **Manage domain sharing and grants**:
   - Use `shareEnable` / `shareDisable` (`applications.share`), `grantSubmit` (`applications.grant`), or `revoke` declared on `grantsList`.
4. **Delete an application**:
   - Invoke `deleteApp` (`applications.delete`) on the selected `platform:Application` (requires confirmation).
5. **Return to the catalogue**:
   - Navigate to `/ontology/applications`.
