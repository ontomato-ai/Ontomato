# Autotest case sets recipes

This panel creates, imports, edits, and deletes `platform:AutotestCaseSet` objects for automatic evaluation runs.

- **Select a case set**: Call `present` with `selected` set to `{ className: "platform:AutotestCaseSet", primaryKey: "<caseSetId>" }`. Switching away from a dirty case set prompts to save and switch, discard changes, or cancel (`unsavedSwitchMode: "save-discard-cancel"`).
- **Search case sets**: Call `present` with `search` set to a case set name or ID keyword; clear `search` to restore the full list. Case sets with unsaved local drafts show a warning indicator dot (`showDraftIndicator: true`).
- **Create an empty case set**: Invoke `createCaseSet.create` (`autotestCaseSet.create`) with `{ name: "<case set name>" }`. The panel selects the created case set automatically.
- **Import cases from JSON or CSV text**: Invoke `importCaseSet.import` (`autotestCaseSet.import`) with `{ name: "<case set name>", format: "auto" | "json" | "csv", content: "<JSON or CSV text>" }`. The panel selects the imported case set automatically.
- **Edit and save a case set**: Fill `/name` and `/cases` on `caseSetForm` (`TestcaseWorkbench`, which synchronizes the case list, single-case form, and live JSON pane and persists unsaved edits across refreshes via `persistDraft: true`) and submit `platform:AutotestCaseSet.save`.
- **Delete a case set**: Invoke `deleteCaseSet.delete` (`autotestCaseSet.delete`) on the selected case set after impact confirmation.
