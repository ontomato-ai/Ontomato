/** Shared artifact presentation rule; shell implementations consume the same contract. */
import prompt from "./agent-artifact-markdown-prompt.json" with { type: "json" };
export const ARTIFACT_MARKDOWN_PROMPT = prompt;

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
