# Turn evidence recipes

This panel browses, collects, retains, downloads, deletes, and diagnoses `platform:TurnEvidence` workspaces.

- **Open a specific Turn**: Call `present` with `selected` set to `{ className: "platform:TurnEvidence", primaryKey: "<turnKey>" }` (and optionally `filePath` set to a relative artifact file path).
- **Filter the Turn list**: Call `present` with `search` set to a Turn key or question keyword; clear `search` to show all workspaces.
- **Collect evidence for a new Turn**: Invoke `buildTurn.build` (owner operation `turnEvidence.build`) with `{ turnKey: "<threadId>/<turnId>" }`. On success, the panel automatically selects the newly created `platform:TurnEvidence` record.
- **Inspect the selected Turn**: Read `detailHeader` / `detailSummary` (`record`) for Turn metadata, status, retention, and `evidenceJson`; read `evidenceRuns` and `evidenceGaps` for resolved runtime runs and missing-evidence warnings; read `fileTree` (`files`) and `fileViewer` (`file` with `path: filePath`) to inspect individual artifact files.
- **Filter artifact files**: Call `present` with `fileSearch` set to a filename or path keyword; clear `fileSearch` to restore the full tree.
- **Refresh, keep/unkeep, download, or delete**: Run `refreshTurn.refresh` (`turnEvidence.refresh`) to re-collect references, `keepTurn.keep` / `unkeepTurn.unkeep` (`turnEvidence.keep` / `turnEvidence.unkeep`) to toggle retention protection, `downloadTurn.download` (`turnEvidence.download`) to export the ZIP archive, or `deleteTurn.delete` (`turnEvidence.delete`) to remove the workspace after impact confirmation.
- **Diagnose with the operations assistant**: Click `diagnose` (`ConversationEntry` targeting the page's default operations diagnosis agent) to open the page composer prefilled for the currently selected Turn; the assistant reads `selected` and `filePath` from this panel's public state.
