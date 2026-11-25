# Audit log

This page is read-only: it lists platform audit log entries (`platform:AuditLog`) with server-side pagination (20 rows per page) and a read-only detail dialog. There are no write operations or editable forms.

- `business` (`deepLink: true`): optional business type filter (`BKNOWLEDGE`, `BTERM`, `BEXAMPLE`, `SCHEMA`, `ANALYSIS`). Omit or clear (`null`) to show all business types.
- `operation` (`deepLink: true`): optional operation type filter (`ADD`, `UPD`, `DEL`). Omit or clear (`null`) to show all operation types.
- `selectedLog` (`deepLink: true`): selected `platform:AuditLog` reference; setting it opens the read-only detail dialog (`logDetail`, reading `record` with full `description` and `parameters`), and closing the dialog clears it back to `null`.
- Use `present` with `business`, `operation`, or `selectedLog` to show a filtered view or inspect a specific audit entry beside the conversation.
