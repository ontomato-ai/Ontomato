---
name: knowledge-governance
description: Read ontology and business knowledge, inspect query history and evidence, and save a governance work record with traceable sources. Use when reviewing knowledge quality or maintaining governance progress.
compatibility: Requires Node.js 18 or newer, an Ontomato workbench URL and authorized tk credential.
---

# Knowledge governance

Use `node <this-skill>/scripts/governance.mjs <command> @work/arguments.json`.
Read [commands](references/commands.md) for argument shapes. These are ordinary
commands in Claude Code, Codex and the product runtime. They never modify live
ontology or business data; they save governance work and evidence references.

Set ONTOMATO_WORKBENCH_URL (base before /api), ONTOMATO_TK (sent as tk), and
optionally ONTOMATO_LANGUAGE / ONTOMATO_CORRELATION_ID. Product execution supplies
ONTOMATO_GOVERNANCE_ID, ONTOMATO_SESSION_ID and ONTOMATO_RUN_ID. Use these values
as supplied. They select a host-authorized run; they do not grant permission.

Outside the product, if ONTOMATO_RUN_ID is absent, the command calls begin to
obtain host business work identity and stores it in work/.governance-run.json.
You can explicitly run `begin @work/begin.json` with `{"message":"Review knowledge"}`
and optional `id` to continue an existing external work record. Begin closes the
previous open run for that record. It creates no runtime agent, and all operations
use your own user permissions. Keep the returned IDs to inspect or continue.
When done, run `close`. Expired/closed run updates return HTTP 409; begin a new
round explicitly to continue, rather than retrying a write against a closed gate.

Read the current work record first and when current progress is needed after
conversation compaction. After changes, use the authoritative returned record.
Read knowledge and ontology, inspect relevant history/evidence, and preserve source
IDs in issues. Explain evidence and uncertainty; do not invent business rules.
