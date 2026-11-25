# Operations knowledge recipes

- **Browse a specific document**: Call `present` with `filePath` set to the relative Markdown path (for example `"index.md"` or `"errors/dsl.md"`). Clicking a directory node in `tree` automatically opens its `index.md` when present, or clears `filePath` when the directory has no index document.
- **Filter the knowledge file tree**: Call `present` with `search` set to a filename or path keyword; clear `search` to restore all files.
- **Follow cross-document links**: Relative `.md` links inside the rendered Markdown automatically update `filePath` and highlight the target document in the tree.
