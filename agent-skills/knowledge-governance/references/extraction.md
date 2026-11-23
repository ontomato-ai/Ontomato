# Extract and import unstructured business knowledge

Use this workflow when the user asks to turn source text into reusable business knowledge or to draft, add or revise a business definition.

1. Establish the source and intended business use. Read the complete relevant source with the governance source commands; preserve the returned source IDs. Use read-input for the current message, or read-history/read-evidence for conversation history and text artifacts. These source commands read content saved by the host; do not invent source IDs.
2. Read the ontology and existing knowledge. Extract discrete, source-supported terminology, facts and attributed statements. Preserve scope, dates, uncertainty and original evidence. Do not invent rules, metrics, object types or relationships.
3. Prepare `items` with stable IDs, concise titles, complete readable text, tags and the registered `sourceIds`. Include source attribution in each text. Avoid duplicate imports; reuse an ID only for the same content.
4. Choose the delivery path for this run.

### Live page

Run `import-knowledge` and use each returned item's `page` (`/ontology/knowledge`) and `form`.

- For `mode: "create"`, call `present({ target: item.page, state: { mode: "create", selected: null, formTarget: null } })`. New entries have `status: 0` (pending).
- For `mode: "update"`, set `target = { className: "platform:BusinessKnowledge", primaryKey: item.id }` and call `present({ target: item.page, state: { mode: "edit", selected: target, formTarget: target } })`. The form values retain the existing status.
- Check the mounted form's target in the page snapshot before calling `fill_form({ member: "form", values: item.form })`. Leave it open for review. When the user asks to save, call `page_action({ operation: "form.save" })`. By default the user confirms in the conversation.

The `form` member can show one live form at a time. For multiple items, present and fill one,
wait for the user to review and save it and for the save to succeed, then proceed to the next.
An `awaiting_confirmation` receipt leaves the form unsaved. Keep pending items for the next turn.

### Without page tools

For an explicit request to import new pending records in a platform background or delegated run,
use [`import-pending`](commands.md) after registering the sources. For updates, approvals, deletions,
or proposals requiring review before saving, return the structured items with their source IDs and
say which changes remain unapplied. Outside the platform, use `import-knowledge` in an external
governance window to import pending records. Report only imports the owner confirmed.

This operation imports business knowledge, not arbitrary object instances or database tables. If the target is structured business facts, prepare an evidence-backed extraction and use an existing authorized Action or the configured external data-ingestion workflow. A missing capability must be reported; never bypass it with database or HTTP writes.
