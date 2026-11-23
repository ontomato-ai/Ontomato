# Commands

Every command accepts one JSON object (inline JSON or @file) and prints JSON.

| Command | Arguments |
| --- | --- |
| read-input | {}; reads and registers the current user's original message as extraction source |
| import-knowledge | `items`: array of `{id, title, text, sourceIds, tags?}`. On the platform returns `items[].page`, `mode`, `form` and `id` for updates for the live form. Outside the platform imports pending records with stable IDs. |
| import-pending | Same input. For an explicitly requested import in a platform run without page tools, writes new pending records via the active governance window. |
| read-knowledge | query?, id?, index?, offset?, maxChars? (1000–20000); start with {} |
| read-ontology | Same pagination as read-knowledge |
| search-history | query?, agentId?, from?, to?, offset?, limit? (1–100); start with {} |
| read-history | hostId, runId, offset?, maxChars? (1000–20000) |
| read-evidence | hostId, runId, artifactId?, offset?, maxChars?; reads runtime messages/artifacts |
| collect-turn-artifacts | Same arguments as read-evidence; reads existing runtime messages/artifacts, never collects logs |
| read-work-record | Same pagination as read-knowledge |
| update-work-record | Optional summary, notes, reviewedKnowledgeIds, issues |

Source registration accompanies the relevant reads. Never substitute a filename
or a display label for the source ID returned by the host. An issue retains id,
title, category (ontology/knowledge/data), status (proposed/pending/confirmed),
problem, before, after, basis and sourceIds. Unknown request fields are rejected;
read the endpoint's error and correct arguments rather than ignoring a failed read.

History search returns records and nextOffset. Time bounds are ISO timestamps, from inclusive and to exclusive. Each record supplies hostId and runId for subsequent reads. Only user questions, final answers and artifacts are available; feedback, decisions and quality annotations are not returned. A null agentId means that the old run did not record its agent identity.

In a platform run without page tools, call
`node <this-skill>/scripts/governance.mjs import-pending @work/arguments.json`
after registering the sources. The script uses the active window or opens it at
`$ONTOMATO_GOVERNANCE_WINDOW_URL` with `tk: $ONTOMATO_GOVERNANCE_CALLBACK` and
`X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. It sends `POST
$ONTOMATO_ONTOLOGY_URL/ontology/ai/knowledge-governance/<recordId>/runs/<runId>/actions/import_knowledge`
with the window's token as `tk` and the window's run and session IDs in
`X-Ontomato-Run-Id` and `X-Ontomato-Session-Id`. When the ontology base is the run callback
address ending in `/ontology`, it also sends `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK`.
The Java import receipt for both `import-pending` and external `import-knowledge` lists newly
written IDs in `imported` and existing IDs with the same title and text in `skipped`.
`status: "pending"` is present only when `imported` has entries and applies only to those IDs.
Skipped entries keep their current state. A reused ID with different title or text is refused.
Use the [extraction workflow](extraction.md) for live forms.
