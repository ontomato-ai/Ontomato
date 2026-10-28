import type { Component } from "vue";
import type { ArtifactRendererOverride } from "./types";

function longestExtension<T extends { extensions?: string[] }>(path: string, entries: readonly T[]): T | null {
  const lower = path.toLowerCase();
  let best: T | null = null;
  let bestLength = 0;
  for (const entry of entries) {
    for (const extension of entry.extensions ?? []) {
      const suffix = extension.toLowerCase();
      if (suffix.length > bestLength && lower.endsWith(suffix)) {
        best = entry;
        bestLength = suffix.length;
      }
    }
  }
  return best;
}

/**
 * Renderer lookup: host override (path pattern, then longest extension) → shell default for the
 * extension → none (the caller shows a file card). Returns the chosen component and the one it
 * replaces, so an override can wrap the default.
 */
export function resolveArtifactRenderer(
  path: string,
  overrides: readonly ArtifactRendererOverride[],
  defaults: readonly ArtifactRendererOverride[],
): { component: Component | null; fallback: Component | null } {
  const shellDefault = longestExtension(path, defaults)?.component ?? null;
  const override =
    overrides.find((entry) => entry.path?.test(path)) ?? longestExtension(path, overrides);
  return override
    ? { component: override.component, fallback: shellDefault }
    : { component: shellDefault, fallback: null };
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
