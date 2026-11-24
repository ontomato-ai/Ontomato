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
- `testMarkdown` (`testMarkdown.test` / `metricViews.test`) and `testJson` (`testJson.testExecute` /
  `metricViews.testExecute`) are standalone `OperationButton` projections mounted inside the test dialog when
  `testOpen: true`. They read the live `definition` form draft together with `testParameters` (selected via
  `testSource: "explicit"` or `"binding:<index>"`) and render Markdown preview/source or formatted JSON with truncation
  warnings without saving.
- `remove` (`remove.delete` / `metricViews.delete`) deletes the selected metric after confirmation, reporting the
  bindings deleted with it.

## Common practice

1. **Look for an existing metric to reuse first.** Read the catalog (`list` / `query` read with `search`) and inspect
   candidate metrics (`header` / `record` read and `definition` / `form` read). Compare the complete logic — grain,
   scope, filters, time semantics, denominators and null handling — before concluding two metrics are the same. When an
   existing metric already answers the question, point to it and its parameters/bindings rather than creating a
   duplicate.
2. **Open the live form and fill the complete definition before testing.** Use `present` to open the metric's
   `definition` form (`selected` for editing, or `{ selected: null, creating: true }` for a new metric — always passing
   `selected: null` alongside `creating: true` when an existing metric is already selected so the form does not keep
   pointing at the previous object). Then use `fill_form` on `definition` to write the complete draft directly on screen:
   `function.queryPackage` (the full `manifest` with `schema`, `entry`, `queries`, `parameterDefs`, `parameterBindings`,
   plus every file under `files`), `function.returnDef.columnLabels` (every output key labeled in the reader's language),
   `function.logic`, `matchQuestions`, and any `bindings` rows with values for every declared parameter. Declare every
   parameter the query package uses and no others; never copy another metric's values into `parameterDefs` as defaults.
3. **Test the filled live draft on real data before saving.** With the draft to test already loaded or filled in
   `definition`, use `present` to open the test dialog by setting `testOpen: true` (along with
   `testSource: "explicit"` or `"binding:<index>"`, optional `testTab: "markdown" | "json"`, and `testParameters`), then
   invoke `page_action` with `testMarkdown.test` (`metricViews.test`, Markdown output) or `testJson.testExecute`
   (`metricViews.testExecute`, raw JSON output with truncation metadata). Neither saves anything. Treat a truncated
   result as partial, never as the complete numbers.
4. **Save through confirmation.** Once the tested draft is ready to persist, invoke
   `page_action({ operation: "definition.save" })` (confirmed in conversation by default).

## Owner rules this page shows and never rejudges

- System metrics and workflow-pending metrics are read-only in the owner's form, with the owner's reason displayed above
  the fields.
- System metrics cannot be deleted: the owner disables the delete action and supplies the reason.
- Saving validates the full definition and bindings on the owner side and marks refused fields with the owner's reasons.
