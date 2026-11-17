---
name: knowledge-governance
description: Review ontology and business knowledge, extract source-backed knowledge from unstructured material, import pending knowledge, and maintain governance work with traceable evidence.
compatibility: Requires Node.js 18 or newer, an Ontomato ontology-service URL and an authorized credential.
---

# Knowledge governance

Use `node <this-skill>/scripts/governance.mjs <command> @work/arguments.json`.
Read [commands](references/commands.md) for arguments and [extraction](references/extraction.md)
when extracting knowledge. Preserve source IDs, evidence and uncertainty; do not invent business rules.
The Java work record is the governance report. Read it when resuming or after compaction;
update the same issue ID for the same disagreement. Confirming meaning does not save a knowledge asset.

In platform runs, the host supplies `ONTOMATO_SKILL_SCENARIO=platform`, a window callback
and the real run identity. The first command requests a write window from Node; no report
is created merely because this skill is installed. Use the returned record ID in
`/governance/reports/<recordId>`. The host closes writes when the run ends or stops.
Do not call close or switch to external begin in a platform run.

Outside the platform, set `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_TK` or `ONTOMATO_API_KEY`,
and optionally `ONTOMATO_LANGUAGE` / `ONTOMATO_CORRELATION_ID`.
Run `begin` with `{"message":"Material to govern"}` and optional `id` to continue a record;
the first ordinary command also begins external work if none exists. Keep the returned IDs.
External begin replaces the previous window, creates no runtime agent, and uses your own permissions.
Run `close` when finished. Expired or closed writes fail with HTTP 409; begin a new round explicitly.

Commands save governance work and source references. `import-knowledge` imports pending knowledge
through the owning interface. Report successful writes only after that interface confirms them.
