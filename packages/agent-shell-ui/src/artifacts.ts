import type { ArtifactRendererRegistration } from "./types";

/** Longest registered extension wins, so `.chart.json` takes precedence over `.json`. */
export function rendererFor(
  path: string,
  renderers: readonly ArtifactRendererRegistration[],
): ArtifactRendererRegistration | null {
  const lower = path.toLowerCase();
  let best: ArtifactRendererRegistration | null = null;
  let bestLength = 0;
  for (const renderer of renderers) {
    for (const extension of renderer.extensions) {
      const suffix = extension.toLowerCase();
      if (suffix.length > bestLength && lower.endsWith(suffix)) {
        best = renderer;
        bestLength = suffix.length;
      }
    }
  }
  return best;
}

export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** Display extension for file cards, e.g. "CHART" for x.chart.json or "CSV". */
export function fileKind(path: string): string {
  const name = fileName(path).toLowerCase();
  if (name.endsWith(".chart.json")) return "chart";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "file";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
