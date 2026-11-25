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

In platform runs, the host supplies `ONTOMATO_SKILL_SCENARIO=platform`, the window callback URL,
and a session credential. Each command that uses the governance record resolves the active write
window through that callback. The workspace keeps the record ID between runs, and the host closes
writes when the run ends or stops.
Do not call close or switch to external begin in a platform run.

Outside the platform, set `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_TK` or `ONTOMATO_API_KEY`,
and optionally `ONTOMATO_LANGUAGE` / `ONTOMATO_CORRELATION_ID`.
Run `begin` with `{"message":"Material to govern"}` and optional `id` to continue a record;
the first ordinary command also begins external work if none exists. Keep the returned IDs.
External begin replaces the previous window, creates no runtime agent, and uses your own permissions.
Run `close` when finished. Expired or closed writes fail with HTTP 409; begin a new round explicitly.

When asked to add or change business knowledge, use the [extraction workflow](references/extraction.md).

- With `present`, `fill_form` and `page_action`, use the live business-knowledge form. Run
  `import-knowledge` to prepare its fields. For updates, fill only the fields being changed.
  Send `status: 0` only for new entries. The `form` member holds one live form at a time.
  Show one item and wait for the user to review and save it before filling the next. Keep any
  unsaved item visible until it is settled. Use `page_action` to request a save only when asked.
- In a background or delegated run without page tools, an explicitly requested import of
  new pending items can use `import-pending` through the current governance window.
  The import cannot update, approve or delete existing knowledge. For those writes or a
  request to review before saving, return the structured proposals to the user or assigning agent.
- Outside the platform, `import-knowledge` imports pending items in an external Java window
  using your credential. Report an import only after the owner confirms it.

In platform replies, keep your `outputs/reports/<name>/report.md` and `#/ontology/knowledge` links
accurate; you may adapt the link text to the reader's language.
Page links are ready-to-paste Markdown links with in-app relative addresses (`#/...`): do not add a
host or construct them with any `ONTOMATO_*_URL`. Do not use image syntax.
