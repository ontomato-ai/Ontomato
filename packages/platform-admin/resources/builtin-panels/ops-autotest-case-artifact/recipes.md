# Autotest case artifacts recipes

- **Open a specific case artifact**: Call `present` with `selected` set to `{ className: "platform:AutotestCaseArtifact", primaryKey: "<runId>::<caseId>" }`.
- **Inspect a specific artifact file**: Call `present` with both `selected` and `filePath` (for example `"manifest.json"` or `"report.md"`). The reader automatically renders Markdown, JSON/code, CSV/TSV tables, or plain text.
- **Filter artifact files**: Call `present` with `fileSearch` set to a filename or folder keyword; clear `fileSearch` to show the full file tree again.
- **Diagnose the case**: Use the `diagnose` `ConversationEntry` button to open the operations diagnosis composer prefilled for the active case artifact.
- **Download the case ZIP**: Invoke the `download` member's `autotestCaseArtifact.download` read operation when runtime evidence references are present.
