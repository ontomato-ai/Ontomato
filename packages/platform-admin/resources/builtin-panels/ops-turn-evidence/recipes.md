# Turn evidence recipes

This panel browses, collects, retains, downloads, deletes, and diagnoses `platform:TurnEvidence` workspaces.

- **Open a specific Turn**: Call `present` with `selected` set to `{ className: "platform:TurnEvidence", primaryKey: "<turnKey>" }` (and optionally `filePath` set to a relative artifact file path).
- **Filter the Turn list**: Call `present` with `search` set to a Turn key or question keyword; clear `search` to show all workspaces.
- **Collect evidence for a new Turn**: Type an exact Turn key (`<threadId>/<turnId>`) in the `turns` search input and press Enter (selects immediately if already listed, otherwise invokes `turns.build`), or invoke `turns.build` (owner operation `turnEvidence.build`) directly with `{ turnKey: "<threadId>/<turnId>" }`. On success, the panel automatically selects the newly created `platform:TurnEvidence` record.
- **Inspect the selected Turn**: Read `detailHeader` (`record`) for Turn metadata, status, retention, and `evidenceJson`; read `evidenceRuns` and `evidenceGaps` for resolved runtime runs and missing-evidence warnings; read `fileTree` (`files`) and `fileViewer` (`file` with `path: filePath`) to inspect individual artifact files on demand.
- **Filter artifact files**: Call `present` with `fileSearch` set to a filename or path keyword; clear `fileSearch` to restore the full tree.
- **Refresh, keep/unkeep, download, or delete**: Use the `turns` list row actions (`keep`, `unkeep`, `delete`) or the detail header operations (`refreshTurn.refresh` / `keepTurn.keep` / `unkeepTurn.unkeep` / `downloadTurn.download` / `deleteTurn.delete`) to re-collect references, toggle retention protection, export the ZIP archive, or remove the workspace after impact confirmation.
- **Diagnose with the operations assistant**: Click `diagnose` (`ConversationEntry` targeting the page's default operations diagnosis agent) to open the page composer prefilled for the currently selected Turn; the assistant reads `selected` and `filePath` from this panel's public state.
