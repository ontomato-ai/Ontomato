import path from "path";

/** One default resource: `from` is the read-only source (file or directory) and `to` the path relative to the target root. */
export interface ResourceCopy {
  from: string;
  to: string;
}

/**
 * Installed by the app before startup according to its own location. Read-only default resources each have an explicit source;
 * runtime data is written only beneath the product runtime root the app provides.
 */
export interface ContentLayout {
  /** Product runtime root: runtime data under its data/, production web pages under its dist/web. */
  runtimeRoot: string;
  /** Default prompts, synced into data/prompts. */
  prompts: readonly ResourceCopy[];
  /** Public skill packages, read directly by all domains. */
  publicSkillsRoot: string;
  /** Optional JSON labels for public skill cards, keyed by skill ID. */
  publicSkillLabelsPath?: string;
  /** Optional localized documentation overlays, relative to the public skill root. */
  publicSkillTranslationsRoot?: string;
  /** Bundled operations knowledge, read directly in both the workbench and diagnostics. */
  knowledgeRoot: string;
  /** Default resources copied into runtime data/. */
  runtimeResources: readonly ResourceCopy[];
}

let layout: ContentLayout | null = null;

export function installContentLayout(next: ContentLayout): void {
  layout = next;
}

function installedLayout(): ContentLayout {
  if (!layout) throw new Error("Workbench content layout is not installed");
  return layout;
}

export function runtimeRoot(): string {
  return installedLayout().runtimeRoot;
}

export function runtimeDataDir(...segments: string[]): string {
  return path.join(installedLayout().runtimeRoot, "data", ...segments);
}

/** Where each domain's own skill packages live, one directory per domain. */
export function domainSkillsRoot(): string {
  return runtimeDataDir("domain-skills");
}

export function bundledAppsSdkDir(...segments: string[]): string {
  return path.join(runtimeRoot(), "dist", "apps-sdk", ...segments);
}

export function webDistDir(): string {
  return path.join(installedLayout().runtimeRoot, "dist", "web");
}

export function promptSources(): readonly ResourceCopy[] {
  return installedLayout().prompts;
}

export function publicSkillsRoot(): string {
  return installedLayout().publicSkillsRoot;
}

export function publicSkillLabelsPath(): string | undefined {
  return installedLayout().publicSkillLabelsPath;
}

export function runtimeResourceSources(): readonly ResourceCopy[] {
  return installedLayout().runtimeResources;
}

export function echartDir(): string {
  return runtimeDataDir("echart");
}

export function knowledgeDir(): string {
  return installedLayout().knowledgeRoot;
}

export function diagnosisSkillsDir(): string {
  return runtimeDataDir("skills");
}

export function publicSkillTranslationsRoot(): string | undefined {
  return installedLayout().publicSkillTranslationsRoot;
}
