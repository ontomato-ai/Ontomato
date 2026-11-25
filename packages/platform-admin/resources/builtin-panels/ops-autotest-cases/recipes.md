# Autotest case sets recipes

This panel creates, imports, edits, and deletes `platform:AutotestCaseSet` objects for automatic evaluation runs.

- **Select a case set**: Call `present` with `selected` set to `{ className: "platform:AutotestCaseSet", primaryKey: "<caseSetId>" }`.
- **Search case sets**: Call `present` with `search` set to a case set name or ID keyword; clear `search` to restore the full list.
- **Switch between form and JSON mode**: Call `present` with `editMode` set to `"form"` (structured `object-array` editor for `/cases`) or `"json"` (raw JSON editor for the same `/cases` field).
- **Create an empty case set**: Invoke `createCaseSet.create` (`autotestCaseSet.create`) with `{ name: "<case set name>" }`. The panel selects the created case set automatically.
- **Import cases from JSON or CSV text**: Invoke `importCaseSet.import` (`autotestCaseSet.import`) with `{ name: "<case set name>", format: "auto" | "json" | "csv", content: "<JSON or CSV text>" }`. The panel selects the imported case set automatically.
- **Edit and save a case set**: Fill `/name` and `/cases` on `caseSetForm` (each case requires a unique `caseId` and non-empty `question`; blank `judgment` receives the default rule on save) and submit `platform:AutotestCaseSet.save`.
- **Delete a case set**: Invoke `deleteCaseSet.delete` (`autotestCaseSet.delete`) on the selected case set after impact confirmation.
