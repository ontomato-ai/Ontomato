# Skill detail

This page shows a read-only full-width view of one skill (`platform:Skill`): a single-row page header with back navigation, skill title, source badge, description summary, and export/delete actions, followed by the package file tree and Markdown/code viewer.

## Page state and reads

- `selected` (deep-linkable): currently opened skill (`{"className": "platform:Skill", "primaryKey": "<skillId>"}`).
- `filePath` (deep-linkable): currently opened file path inside the skill package (defaults to `SKILL.md` when present, otherwise the first file in folder-first alphabetical order).
- Read `headerTitle` (`ObjectHeader`, reading `record`) for the skill's title, source, and status; read `summary` (`TypedValue`, reading `record`) for the description; read `tree` (`ObjectTree`, reading `files`) for the package file list; read `content` (`ObjectTextReader`, reading `file` with `path`) for a file's UTF-8 content.

## Operations

- **Export (`exportSkill.export` / `skills.export`)**: read-only operation declared on `exportSkill` targeting `selected`, returning the skill package `.zip` archive for download.
- **Delete (`remove.delete` / `skills.delete`)**: write operation declared on `remove` targeting `selected`, guarded by `skill-management`. Built-in and provider skills are read-only and reported as unavailable by the owner. For domain-owned skills, confirm with the reader (the host confirmation lists affected agents) before deleting. After a successful delete, the page navigates back to `/ontology/skills`.

## Navigation

- Return to the skill library catalog: click Back in the page header, or open `/ontology/skills`.
