# Skill library

This page browses the platform's skills (`platform:Skill`), inspects the selected skill's package files, and runs owner operations to import, export, or delete domain-owned skills.

## Page state and reads

- `search` (deep-linkable): current filter text for the skill list (`list` member reading `query`).
- `selected` (deep-linkable): currently selected skill (`{className: "platform:Skill", primaryKey: "<skillId>"}`).
- `filePath` (deep-linkable): currently open file path inside the selected skill's package (defaults to `SKILL.md` when present).
- Read `detail` (`ObjectHeader`, reading `record`) for the selected skill's title, description, source, and write restriction; read `tree` (`ObjectTree`, reading `files`) for the package file list and `content` (`ObjectTextReader`, reading `file` with `path`) for a file's UTF-8 content.

## Operations

- **Import (`import.import` / `skills.import`)**: requires a `.zip` skill package uploaded by the reader via the page's import control. Do not fabricate an upload ID; ask the reader to upload the `.zip` archive.
- **Export (`detail.export` / `skills.export`)**: read-only operation declared on `detail` targeting `selected`, returning the skill package `.zip` for download.
- **Delete (`detail.remove` / `skills.delete`)**: write operation declared on `detail` targeting `selected`, guarded by `skill-management`. Built-in and provider skills are read-only and unavailable for deletion. For domain-owned skills, confirm with the reader (the host confirmation lists affected agents) before deleting.
