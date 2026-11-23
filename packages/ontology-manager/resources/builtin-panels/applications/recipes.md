# Applications catalogue — agent recipes

This page lists platform and domain applications (`platform:Application`) at `/ontology/applications`.

## Public states

- `search`: keyword filter for the application catalogue.
- `scope`: `"visible"` (all visible applications) or `"maintainable"` (applications the current user can maintain).
- `sort`: `"id"` (default product order), `"name"`, or `"updated"`.
- `creating`: `true` opens the centered create-application dialog (`createForm`; public state only, not written to the URL).

## Common flows

1. **Inspect or maintain an application**:
   - Click a row or navigate to `/ontology/applications/detail?selected=<app-id>`.
   - Identity editing (including `allowStandalone`), runtime summary (including copyable `externalLink`), entry maintenance, panels & projections inspection, grants & sharing, and deletion all live on `/ontology/applications/detail`.
2. **Create an application**:
   - Set `creating: true` (or click "New application") and draft `platform:Application.save` targeting `createForm`.
   - Leave the draft for the reader to review and submit; upon saving, the page navigates to the new application's detail entry.
