# Metric views panel: common practice

This page manages this domain's metric views (`platform:MetricView`): browse and search the catalog, edit or create a
metric view definition and its parameter bindings, test an unsaved definition against real data, batch-change
publication status, and delete metrics. The page has no built-in natural-language generation button: new or updated
definitions are prepared in this conversation, tested here, and drafted into the form for a person to review and save.

## Page structure

- `list` reads the owner's catalog (`query` read, searchable by name and description via panel state `search`), showing
  name, description, linked function, origin, status, creator, reviewer and last updated time.
- Selecting a row sets panel state `selected` (`deepLink: true`) and opens the detail view with the official header
  (`header`, `record` read) and the owner's definition form (`definition`, `form` / `createForm` reads, saved via
  `definition.save` / `platform:MetricView.save`).
- The header's primary "New Metric View" button clears `selected` and sets `creating: true` to open a blank definition
  form.
- `publishStatus` (`publishStatus.setStatus` / `metricViews.setStatus`) is a batch `OperationButton` bound to `checked`
  and `batchStatus` (`PENDING_REVIEW`, `PUBLISHED`, `UNUSED`), updating the publication status of checked rows and
  reporting per-metric outcomes.
- `remove` (`remove.delete` / `metricViews.delete`) deletes the selected metric after confirmation, reporting the
  bindings deleted with it.

## Common practice

1. **Look for an existing metric to reuse first.** Read the catalog (`list` / `query` read with `search`) and inspect
   candidate metrics (`header` / `record` read and `definition` / `form` read). Compare the complete logic — grain,
   scope, filters, time semantics, denominators and null handling — before concluding two metrics are the same. When an
   existing metric already answers the question, point to it and its parameters/bindings rather than creating a
   duplicate.
2. **When a new measure is needed, write the complete definition.** Fill `function.queryPackage` (the full `manifest`
   with `schema`, `entry`, `queries`, `parameterDefs`, `parameterBindings`, plus every file under `files`),
   `function.returnDef.columnLabels` (every output key labeled in the reader's language), `function.logic`,
   `matchQuestions`, and any `bindings` rows with values for every declared parameter. Declare every parameter the query
   package uses and no others; never copy another metric's values into `parameterDefs` as defaults.
3. **Test on real data before drafting.** Use the two read-only trial operations declared on the `definition` form
   member — `definition.test` (`metricViews.test`, Markdown output) and `definition.testExecute`
   (`metricViews.testExecute`, raw JSON output with truncation metadata) — with `{ draft, parameters }`. Neither saves
   anything. Treat a truncated result as partial, never as the complete numbers.
4. **Fill the live form and save through confirmation.** Use `present` to open the metric's `definition` form — or, for a new metric (especially when an existing metric is already selected), always pass `{ selected: null, creating: true }` so `selected` is cleared and the form does not keep pointing at the previous object — then use `fill_form` to enter the fields directly on screen and `page_action({ operation: "definition.save" })` when ready to save (confirmed in conversation by default).

## Owner rules this page shows and never rejudges

- System metrics and workflow-pending metrics are read-only in the owner's form, with the owner's reason displayed above
  the fields.
- System metrics cannot be deleted: the owner disables the delete action and supplies the reason.
- Saving validates the full definition and bindings on the owner side and marks refused fields with the owner's reasons.
