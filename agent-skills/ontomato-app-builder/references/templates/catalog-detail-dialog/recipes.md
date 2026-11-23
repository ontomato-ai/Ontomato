# Manage records

- Public state `selected` holds the currently open record (`null` while browsing the catalog or creating). Setting
  `creating: true` with `selected: null` opens the centered create dialog (also triggered by the header's primary
  `create` command).
- Before proposing an edit, read the selected record's current fields and owner `form` description. Preserve fields
  outside the requested change.
- For creation, read the owner's `createForm` description and omit `target.id` in the page draft so the panel opens the
  create dialog pre-filled for the reader to review and save.
- For destructive operations (such as delete), confirm the target record's name with the reader before invoking the
  declared operation.
