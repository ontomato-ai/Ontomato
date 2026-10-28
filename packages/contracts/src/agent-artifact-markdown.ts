/** Shared artifact presentation rule; shell implementations consume the same contract. */
export const ARTIFACT_MARKDOWN_PROMPT =
  "Reference produced files with workspace-relative outputs/ paths. Use Markdown image syntax ![title](outputs/path) for inline content and Markdown link syntax [title](outputs/path) for a file card opened in the side panel. Choose one form for each intended presentation. Do not embed full dataset contents in the reply.";

/**
 * Normalizes a Markdown destination to an artifact path, or null for ordinary links.
 * Accepts `outputs/...` and `./outputs/...`; rejects traversal, absolute paths and URLs.
 */
export function artifactPath(destination: string): string | null {
  let path = destination.trim();
  try {
    path = decodeURI(path);
  } catch {
    return null;
  }
  if (path.startsWith("./")) path = path.slice(2);
  if (!path.startsWith("outputs/") || path.length === "outputs/".length) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return null;
  return path;
}
