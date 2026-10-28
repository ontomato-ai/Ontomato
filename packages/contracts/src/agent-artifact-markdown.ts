/** Shared artifact presentation rule; shell implementations consume the same contract. */
export const ARTIFACT_MARKDOWN_PROMPT =
  "Reference produced files with workspace-relative outputs/ paths. Use Markdown image syntax ![title](outputs/path) for inline content and Markdown link syntax [title](outputs/path) for a file card opened in the side panel. Choose one form for each intended presentation. Do not embed full dataset contents in the reply.";
