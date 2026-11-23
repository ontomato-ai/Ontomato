# Manage records

- Public state `selected` (`deepLink: true`) holds the currently open record (`null` while browsing the catalog or
  creating). Public state `creating` (never `deepLink: true`) opens the centered create dialog when set to `true` with
  `selected: null`.
- Humans and agents operate the same form, button, API, and permission. Before proposing an edit, read the selected
  record's current fields and owner `form` description. Preserve fields outside the requested change.
- Fill the live form directly in the same round (`present` with a `page-draft.json` targeting the record's `objectType`
  and `id`, or omitting `id` for creation) so changed fields highlight immediately without saving. If the user already
  has unsaved edits (`UNSAVED_FORM_CONFLICT`), ask before overwriting.
- For destructive operations (such as delete), confirm the target record's name with the reader before invoking the
  declared operation.
