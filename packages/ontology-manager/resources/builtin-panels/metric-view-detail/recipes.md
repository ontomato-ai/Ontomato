# Metric view detail: common practice

This page is the full-width detail and creation entry for one metric view (`platform:MetricView`) at
`/ontology/assets/metrics/detail`: inspect or edit a metric view's definition, query package, column labels, logic and
parameter bindings, run live draft tests against real data, save or discard changes in the page header, or delete the
metric. There is no built-in natural-language generation button: new or updated definitions are drafted in this
conversation, tested here, and filled into the live form for a person to review and save.

## Page structure

- Deep-linked state `selected` (`platform:MetricView`) opens an existing metric view; deep-linked state
  `mode: "create"` (when `selected` is empty) opens the full-width blank creation form.
- Single-row `<page-header>` carries the back link to `/ontology/assets/metrics`, the metric's title (`header` /
  `ObjectHeader` with `:fallback-title`, or the live draft name in create mode), the **Test** button, the owner delete
  action (`remove` / `metricViews.delete`, hidden when unavailable), and the header **Save** / **Discard** controls
  wired to `definition`.
- `definition` (`ObjectForm`, `form` / `createForm` reads, saved via `definition.save` / `platform:MetricView.save`)
  mounts only in create mode or once the selected metric record is ready; `loading`, `awaiting`, `forbidden`, `error`,
  and `missing` states render in place without mounting the form.
- `testMarkdown` (`testMarkdown.test` / `metricViews.test`) and `testJson` (`testJson.testExecute` /
  `metricViews.testExecute`) are `PanelData` operations bound through `usePanelOperation` and triggered from the test
  dialog footer when `testOpen: true`. They share a single busy guard, read the live `definition` draft together with
  `testParameters` (selected via `testSource: "explicit"` or `"binding:<index>"`), and display Markdown preview/source
  or formatted JSON with truncation warnings via `<operation-result>` inside the result tabs without saving. JSON
  execution tests require the current draft status to be `PUBLISHED` (in addition to the owner's own executability check).

## Common practice

1. **Open the live form and fill the complete definition before testing.** Use `present` on
   `/ontology/assets/metrics/detail` with `{ selected }` for editing or `{ selected: null, mode: "create" }` for a new
   metric. Then use `fill_form` on `definition` to write the complete draft directly on screen: `function.queryPackage`
   (the full `manifest` with `schema`, `entry`, `queries`, `parameterDefs`, `parameterBindings`, plus every file under
   `files`), `function.returnDef.columnLabels` (every output key labeled in the reader's language), `function.logic`,
   `matchQuestions`, and any `bindings` rows with values for every declared parameter. Declare every parameter the
   query package uses and no others; never copy another metric's values into `parameterDefs` as defaults.
2. **Test the filled live draft on real data before saving.** With the draft loaded or filled in `definition`, use
   `present` to open the test dialog by setting `testOpen: true` (along with `testSource: "explicit"` or
   `"binding:<index>"`, optional `testTab: "markdown" | "json"`, and `testParameters`), then invoke `page_action` with
   `testMarkdown.test` (`metricViews.test`, Markdown output) or `testJson.testExecute` (`metricViews.testExecute`, raw
   JSON output with truncation metadata). Neither saves anything. Treat a truncated result as partial, never as the
   complete numbers.
3. **Save or discard.** Invoke `page_action({ operation: "definition.save" })` (confirmed in conversation by default),
   or let the reader use the page header **Save** / **Discard** controls. Saving edits to an existing metric returns to
   `/ontology/assets/metrics`; saving a newly created metric automatically switches the URL to
   `/ontology/assets/metrics/detail?selected=<id>` and clears `mode`; discarding a creation draft returns to
   `/ontology/assets/metrics`.
4. **Delete.** Confirm with the reader before invoking `remove.delete` (`metricViews.delete`); deletion reports the
   bindings removed with the metric and returns to `/ontology/assets/metrics` on success.

## Owner rules this page shows and never rejudges

- System metrics and workflow-pending metrics are read-only in the owner's form, with the owner's reason displayed above
  the fields.
- System metrics cannot be deleted: the owner marks `metricViews.delete` unavailable and the page hides the delete
  button (`hideWhenUnavailable: true`).
- Saving validates the full definition and bindings on the owner side and marks refused fields with the owner's reasons.
