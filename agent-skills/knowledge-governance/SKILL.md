---
name: knowledge-governance
description: Review ontology and business knowledge, extract source-backed knowledge from unstructured material, import pending knowledge, and maintain governance work with traceable evidence.
compatibility: Requires Node.js 18 or newer, an Ontomato ontology-service URL and an authorized credential.
---

# Knowledge governance

Use `node <this-skill>/scripts/governance.mjs <command> @work/arguments.json`.
Read [commands](references/commands.md) for arguments and [extraction](references/extraction.md)
when extracting knowledge. Preserve source IDs, evidence and uncertainty; do not invent business rules.
Keep saving governance work in the Java work record (`read-work-record`, `update-work-record`) for
resuming across turns or after compaction and for deduplicating issues; update the same issue ID for
the same disagreement. Confirming meaning does not save a knowledge asset.

For the human-facing report, follow the `assistant-report` skill and write an ordinary analysis report
to `outputs/reports/<name>/report.md`, then link it in your final reply. Include:
- a summary and the review progress at the time of writing (`reviewed N / total M` when total is known);
- each finding's category, status, problem, current wording or state, proposed change, and basis;
- cited sources as short excerpts; link business knowledge entries to `#/ontology/knowledge` and
  link historical runs to that conversation (`#/agents/chat?sessionId=<sessionId>`).
The report is a snapshot at the time it is written; write a new report version if subsequent runs change it.

When human decisions are needed (such as which recommendations to adopt or how to revise definitions),
ask via pending questions (`agent` tool with `op: "send"`, `session: "parent"`, `needsInput: true`,
options with descriptions and one `isDefault: true`, and `defaultAssumption`). If there are too many
questions to ask at once, split them by priority across turns; readers may also reply directly in conversation.

In platform runs, the host supplies `ONTOMATO_SKILL_SCENARIO=platform`, a window callback
and the real run identity. The first command requests a write window from Node; no report
is created merely because this skill is installed. The host closes writes when the run ends or stops.
Do not call close or switch to external begin in a platform run.

Outside the platform, set `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_TK` or `ONTOMATO_API_KEY`,
and optionally `ONTOMATO_LANGUAGE` / `ONTOMATO_CORRELATION_ID`.
Run `begin` with `{"message":"Material to govern"}` and optional `id` to continue a record;
the first ordinary command also begins external work if none exists. Keep the returned IDs.
External begin replaces the previous window, creates no runtime agent, and uses your own permissions.
Run `close` when finished. Expired or closed writes fail with HTTP 409; begin a new round explicitly.

Commands save governance work and source references. When the user asks to draft, add or change
business knowledge, including a definition not yet recorded, use `import-knowledge`.
In platform runs it inspects existing knowledge and prints structured items (`mode: "create" | "update"`,
target `id` on update, `status: 0` for new items or existing status on update). Open `/ontology/knowledge`
with `present`, switch the form to `create` or `edit` for each item, fill the live form with `fill_form`,
and save via `page_action` (or leave it unsaved for the user to review on the page). A recommendation
in the report is not a saved knowledge entry. Outside the platform it calls Java import
with your credential. Report imported knowledge only after that interface confirms it.

In platform replies, keep your `outputs/reports/<name>/report.md` and `#/ontology/knowledge` links
accurate; you may adapt the link text to the reader's language.
Page links are ready-to-paste Markdown links with in-app relative addresses (`#/...`): do not add a
host or construct them with any `ONTOMATO_*_URL`. Do not use image syntax.
