# Skill library catalog

This page displays the domain's visible skills (`platform:Skill`) as a full-width card grid with search, diagnostics, per-card export and delete actions, and a ZIP import dialog. Clicking a skill card opens the full-width read-only detail page at `/ontology/skills/detail`.

## Page state and reads

- `search` (deep-linkable): current search keyword passed to `list` (`ObjectList`, reading `query`).
- `importing` (not deep-linkable): `true` when the centered ZIP import dialog is open.
- Read `list` (`ObjectList`, reading `query`) for the visible skills (`primaryKey`, `label`, `subtitle` / `description`, `source`, `writeRestriction`), total count, and any owner `diagnostics`.

## Operations

- **Import (`import.import` / `skills.import`)**: uploading a `.zip` skill package from the reader's device is strictly human-operated. You may bring the reader to the import entry with `present({ importing: true })`, but never fabricate an upload ID, pick files, or submit the upload on the reader's behalf.
- **Export (`list.export` / `skills.export`)**: per-card read-only operation declared on `list`, returning the chosen skill's `.zip` archive for download.
- **Delete (`list.remove` / `skills.delete`)**: per-card write operation declared on `list`, guarded by `skill-management`. Built-in and provider skills are read-only and reported as unavailable by the owner. For domain-owned skills, confirm with the reader (the host confirmation lists affected agents) before deleting.

## Navigation

- Inspect a skill's package files and contents: open `/ontology/skills/detail?selected=<skillId>` (optionally with `&filePath=<path>`).
