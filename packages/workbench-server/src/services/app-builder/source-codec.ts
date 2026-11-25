import { createHash } from "node:crypto";
import { z } from "zod";
import { applicationSourceManifestSchema, type ApplicationSourceManifest } from "@ontomato/contracts/application-catalogue";
import { applicationMetadataSchema } from "@ontomato/contracts/application-metadata";
import { panelManifestSchema, panelThemeOverridesSchema } from "@ontomato/contracts/panel-manifest";
import {
  applicationPanelUseSchema, isApplicationPanelUse, panelDefinitionContentSchema,
  productPanelContentSchema, productPanelInputSchema, productProjectionInputSchema,
  type ApplicationDelivery, type ApplicationPanelUse, type PanelDefinitionContent,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import type { WorkspaceFile } from "@ontomato/contracts/workspaces";
import { HttpError } from "../../utils/errors";

export const APPLICATION_SOURCE_FILE = "application.json";
export const PANELS_SOURCE_DIR = "panels";
export const PROJECTIONS_SOURCE_DIR = "projections";

export type { ApplicationSourceManifest } from "@ontomato/contracts/application-catalogue";

const legacyApplicationSourceSchema = z.object({
  entryAccess: z.array(z.string()).optional(),
  declaration: z.object({ permissions: z.array(z.unknown()).optional() }).passthrough(),
  panelUses: z.array(z.object({
    id: applicationPanelUseSchema.shape.id,
    access: z.union([
      z.object({ kind: z.literal("domain-member") }).strict(),
      z.object({ permissionCode: z.string().min(1) }).strict(),
    ]),
  }).passthrough()),
}).passthrough();

function readStoredApplicationSource(source: unknown): ApplicationSourceManifest {
  if (source && typeof source === "object" && ("entryAccess" in source ||
      ("panelUses" in source && Array.isArray(source.panelUses) &&
        source.panelUses.some(use => use && typeof use === "object" && "access" in use)))) {
    const { entryAccess, panelUses, declaration, ...legacy } = legacyApplicationSourceSchema.parse(source);
    const { permissions: _permissions, ...metadata } = declaration;
    // Stored sources without an application qualifier used domain admission when first published.
    const open = entryAccess === undefined || entryAccess.includes("domain-member");
    const initialOpenEntryIds = panelUses.filter(use => open && "kind" in use.access).map(use => use.id);
    return applicationSourceManifestSchema.parse({
      ...legacy, initialOpenEntryIds, declaration: metadata,
      panelUses: panelUses.map(({ access: _access, ...use }) => use),
    });
  }
  return applicationSourceManifestSchema.parse(source);
}

const panelSourceDescriptorSchema = z.object({
  name: productPanelInputSchema.shape.name,
  description: productPanelInputSchema.shape.description,
  visibility: productPanelInputSchema.shape.visibility,
  template: z.boolean().optional(),
  theme: panelThemeOverridesSchema.optional(),
  manifest: panelManifestSchema,
  content: productPanelContentSchema.pick({ messages: true }).optional(),
}).strict();

const legacyPanelDescriptorSchema = z.object({
  manifest: panelManifestSchema,
  content: productPanelContentSchema.pick({ messages: true }).optional(),
}).strict();

export interface LivePanelResource {
  id: string;
  revision: number;
  input: ProductPanelInput;
}

export interface LiveProjectionResource {
  id: string;
  revision: number;
  input: ProductProjectionInput;
}

export interface LivePanelApplicationSnapshot {
  kind: "panel";
  appId: string;
  application: ApplicationSourceManifest;
  /** Only domain panels owned by this application (excludes builtins and panels owned by other apps). */
  panels: LivePanelResource[];
  /** Only domain projections owned by this application (excludes builtins and projections owned by other apps). */
  projections: LiveProjectionResource[];
}

export interface LiveHostedApplicationSnapshot {
  kind: "hosted";
  appId: string;
  declaration: z.infer<typeof applicationMetadataSchema>;
  allowStandalone?: boolean;
  entryPath: string;
  releaseId: string | null;
}

export type LiveApplicationSnapshot = LivePanelApplicationSnapshot | LiveHostedApplicationSnapshot;

export const applicationLiveFingerprintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("panel"),
    applicationHash: z.string().min(1),
    panels: z.record(z.string(), z.object({
      revision: z.number().int().nonnegative(),
      hash: z.string().min(1),
    }).strict()),
    projections: z.record(z.string(), z.object({
      revision: z.number().int().nonnegative(),
      hash: z.string().min(1),
    }).strict()),
  }).strict(),
  z.object({
    kind: z.literal("hosted"),
    applicationHash: z.string().min(1),
    releaseId: z.string().nullable(),
  }).strict(),
]);
export type ApplicationLiveFingerprint = z.infer<typeof applicationLiveFingerprintSchema>;

export interface DriftItem {
  kind: "application" | "panel" | "projection";
  id: string;
  label: string;
  status: "modified" | "added" | "removed";
}

export interface DriftReport {
  hasDrift: boolean;
  items: DriftItem[];
}

export type ParsedApplicationSource =
  | {
      kind: "panel-app";
      application: ApplicationSourceManifest;
      panels: Array<{ id: string; input: ProductPanelInput }>;
      projections: Array<{ id: string; input: ProductProjectionInput }>;
    }
  | {
      kind: "legacy-single-panel";
      panel: PanelDefinitionContent;
    }
  | {
      kind: "hosted";
      hasIndexHtml: true;
    }
  | {
      kind: "empty";
    };

/** Deterministically sorts object keys recursively while preserving array element order. */
export function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) out[key] = canonicalizeJson(entry);
  }
  return out;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value), null, 2) + "\n";
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeJson(value))).digest("hex");
}

function utf8File(filePath: string, content: string): WorkspaceFile {
  return { path: filePath, encoding: "utf8", content };
}

/**
 * Serializes a live domain panel application snapshot into the canonical source tree.
 * Every field of the application, owned panels, and owned projections is preserved verbatim
 * so `serialize -> parse -> publish` is lossless.
 */
export function serializeApplicationSource(snapshot: LivePanelApplicationSnapshot): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  const manifest = applicationSourceManifestSchema.parse(snapshot.application);
  files.push(utf8File(APPLICATION_SOURCE_FILE, canonicalJsonString(manifest)));

  const sortedPanels = [...snapshot.panels].sort((a, b) => a.id.localeCompare(b.id));
  for (const { id, input } of sortedPanels) {
    const parsed = productPanelInputSchema.parse(input);
    const dir = `${PANELS_SOURCE_DIR}/${id}`;
    const descriptor: z.infer<typeof panelSourceDescriptorSchema> = {
      name: parsed.name,
      description: parsed.description,
      visibility: parsed.visibility,
      ...(parsed.template !== undefined && { template: parsed.template }),
      ...(parsed.theme !== undefined && { theme: parsed.theme }),
      manifest: parsed.manifest,
      ...(parsed.content.messages !== undefined && { content: { messages: parsed.content.messages } }),
    };
    files.push(utf8File(`${dir}/panel.json`, canonicalJsonString(descriptor)));
    files.push(utf8File(`${dir}/panel.html`, parsed.content.html));
    if (parsed.content.module !== undefined) files.push(utf8File(`${dir}/panel.mjs`, parsed.content.module));
    if (parsed.content.style !== undefined) files.push(utf8File(`${dir}/panel.css`, parsed.content.style));
    if (parsed.content.recipes !== undefined) files.push(utf8File(`${dir}/recipes.md`, parsed.content.recipes));
  }

  const sortedProjections = [...snapshot.projections].sort((a, b) => a.id.localeCompare(b.id));
  for (const { id, input } of sortedProjections) {
    const parsed = productProjectionInputSchema.parse(input);
    files.push(utf8File(`${PROJECTIONS_SOURCE_DIR}/${id}.json`, canonicalJsonString(parsed)));
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function decodeFileText(file: WorkspaceFile): string {
  return file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
}

function parseJsonSource(filePath: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(
      400,
      `Invalid JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      "APPLICATION_SOURCE_INVALID",
    );
  }
}

/**
 * Parses a workspace file set into the canonical panel-app bundle, with read-only fallback
 * for legacy single-panel roots (`panel.json` + `panel.html`) and legacy hosted `index.html`.
 */
export function parseApplicationSource(files: readonly WorkspaceFile[]): ParsedApplicationSource {
  const byPath = new Map<string, WorkspaceFile>();
  for (const file of files) byPath.set(file.path, file);

  const appFile = byPath.get(APPLICATION_SOURCE_FILE);
  if (appFile) {
    const application = readStoredApplicationSource(
      parseJsonSource(APPLICATION_SOURCE_FILE, decodeFileText(appFile)),
    );

    const panelIds = new Set<string>();
    const projectionIds = new Set<string>();
    for (const filePath of byPath.keys()) {
      const panelMatch = /^panels\/([^/]+)\/panel\.json$/.exec(filePath);
      if (panelMatch) panelIds.add(panelMatch[1]!);
      const projMatch = /^projections\/([^/]+)\.json$/.exec(filePath);
      if (projMatch) projectionIds.add(projMatch[1]!);
    }

    const panels: Array<{ id: string; input: ProductPanelInput }> = [];
    for (const panelId of [...panelIds].sort()) {
      domainProductIdSchema.parse(panelId);
      const dir = `${PANELS_SOURCE_DIR}/${panelId}`;
      const descriptorFile = byPath.get(`${dir}/panel.json`)!;
      const htmlFile = byPath.get(`${dir}/panel.html`);
      if (!htmlFile) {
        throw new HttpError(400, `Missing '${dir}/panel.html' for panel '${panelId}'`, "APPLICATION_SOURCE_INVALID");
      }
      const descriptor = panelSourceDescriptorSchema.parse(
        parseJsonSource(`${dir}/panel.json`, decodeFileText(descriptorFile)),
      );
      const moduleFile = byPath.get(`${dir}/panel.mjs`);
      const styleFile = byPath.get(`${dir}/panel.css`);
      const recipesFile = byPath.get(`${dir}/recipes.md`);
      const input = productPanelInputSchema.parse({
        name: descriptor.name,
        description: descriptor.description,
        visibility: descriptor.visibility,
        ...(descriptor.template !== undefined && { template: descriptor.template }),
        ...(descriptor.theme !== undefined && { theme: descriptor.theme }),
        manifest: descriptor.manifest,
        content: {
          html: decodeFileText(htmlFile),
          ...(moduleFile && { module: decodeFileText(moduleFile) }),
          ...(styleFile && { style: decodeFileText(styleFile) }),
          ...(recipesFile && { recipes: decodeFileText(recipesFile) }),
          ...(descriptor.content?.messages !== undefined && { messages: descriptor.content.messages }),
        },
      });
      panels.push({ id: panelId, input });
    }

    const projections: Array<{ id: string; input: ProductProjectionInput }> = [];
    for (const projectionId of [...projectionIds].sort()) {
      domainProductIdSchema.parse(projectionId);
      const filePath = `${PROJECTIONS_SOURCE_DIR}/${projectionId}.json`;
      const input = productProjectionInputSchema.parse(
        parseJsonSource(filePath, decodeFileText(byPath.get(filePath)!)),
      );
      projections.push({ id: projectionId, input });
    }

    return { kind: "panel-app", application, panels, projections };
  }

  // Read-only compatibility for legacy single-panel workspace roots.
  const rootPanelJson = byPath.get("panel.json");
  const rootPanelHtml = byPath.get("panel.html");
  if (rootPanelJson && rootPanelHtml) {
    const descriptor = legacyPanelDescriptorSchema.parse(
      parseJsonSource("panel.json", decodeFileText(rootPanelJson)),
    );
    const moduleFile = byPath.get("panel.mjs");
    const styleFile = byPath.get("panel.css");
    const recipesFile = byPath.get("recipes.md");
    const panel = panelDefinitionContentSchema.parse({
      manifest: descriptor.manifest,
      content: {
        html: decodeFileText(rootPanelHtml),
        ...(moduleFile && { module: decodeFileText(moduleFile) }),
        ...(styleFile && { style: decodeFileText(styleFile) }),
        ...(recipesFile && { recipes: decodeFileText(recipesFile) }),
        ...(descriptor.content?.messages !== undefined && { messages: descriptor.content.messages }),
      },
    });
    return { kind: "legacy-single-panel", panel };
  }

  if (byPath.has("index.html")) {
    return { kind: "hosted", hasIndexHtml: true };
  }

  return { kind: "empty" };
}

/** Returns true if a file path belongs to the platform-managed application source set. */
export function isManagedApplicationSourcePath(filePath: string): boolean {
  if (filePath === APPLICATION_SOURCE_FILE) return true;
  if (/^panels\/[^/]+\/(?:panel\.json|panel\.html|panel\.mjs|panel\.css|recipes\.md)$/.test(filePath)) return true;
  if (/^projections\/[^/]+\.json$/.test(filePath)) return true;
  return false;
}

const CONFLICT_MARKER_REGEX = /^(?:<{7} |={7}$|>{7} )/m;

/** Returns sorted paths of managed files containing unresolved 3-way merge conflict markers. */
export function detectConflictMarkers(files: readonly WorkspaceFile[]): string[] {
  const conflicted: string[] = [];
  for (const file of files) {
    if (!isManagedApplicationSourcePath(file.path)) continue;
    const text = decodeFileText(file);
    if (
      text.includes("<<<<<<< ") &&
      text.includes("\n=======\n") &&
      text.includes(">>>>>>> ") &&
      CONFLICT_MARKER_REGEX.test(text)
    ) {
      conflicted.push(file.path);
    }
  }
  return conflicted.sort();
}

export function computeLiveFingerprint(snapshot: LiveApplicationSnapshot): ApplicationLiveFingerprint {
  if (snapshot.kind === "hosted") {
    return {
      kind: "hosted",
      applicationHash: sha256Canonical({
        declaration: snapshot.declaration,
        allowStandalone: snapshot.allowStandalone ?? null,
        entryPath: snapshot.entryPath,
      }),
      releaseId: snapshot.releaseId,
    };
  }
  const panels: Record<string, { revision: number; hash: string }> = {};
  for (const panel of [...snapshot.panels].sort((a, b) => a.id.localeCompare(b.id))) {
    panels[panel.id] = {
      revision: panel.revision,
      hash: sha256Canonical(panel.input),
    };
  }
  const projections: Record<string, { revision: number; hash: string }> = {};
  for (const projection of [...snapshot.projections].sort((a, b) => a.id.localeCompare(b.id))) {
    projections[projection.id] = {
      revision: projection.revision,
      hash: sha256Canonical(projection.input),
    };
  }
  const { initialOpenEntryIds: _opening, ...definition } = snapshot.application;
  return {
    kind: "panel",
    applicationHash: sha256Canonical(definition),
    panels,
    projections,
  };
}

/**
 * Compares the baseline fingerprint (recorded on materialize/publish/rollback/sync) against
 * the current live fingerprint. Only resources belonging to this application are compared.
 */
export function diffFingerprints(
  baseline: ApplicationLiveFingerprint | null,
  live: ApplicationLiveFingerprint,
  labels: {
    applicationLabel: string;
    panelLabels?: ReadonlyMap<string, string>;
    projectionLabels?: ReadonlyMap<string, string>;
  },
): DriftReport {
  if (!baseline) return { hasDrift: false, items: [] };
  const items: DriftItem[] = [];

  if (baseline.kind !== live.kind) {
    items.push({ kind: "application", id: "application", label: labels.applicationLabel, status: "modified" });
    return { hasDrift: true, items };
  }

  if (baseline.kind === "hosted" && live.kind === "hosted") {
    if (baseline.applicationHash !== live.applicationHash || baseline.releaseId !== live.releaseId) {
      items.push({ kind: "application", id: "application", label: labels.applicationLabel, status: "modified" });
    }
    return { hasDrift: items.length > 0, items };
  }

  if (baseline.kind === "panel" && live.kind === "panel") {
    if (baseline.applicationHash !== live.applicationHash) {
      items.push({ kind: "application", id: "application", label: labels.applicationLabel, status: "modified" });
    }
    const panelIds = new Set([...Object.keys(baseline.panels), ...Object.keys(live.panels)]);
    for (const id of [...panelIds].sort()) {
      const prev = baseline.panels[id];
      const curr = live.panels[id];
      const label = labels.panelLabels?.get(id) ?? id;
      if (!prev && curr) items.push({ kind: "panel", id, label, status: "added" });
      else if (prev && !curr) items.push({ kind: "panel", id, label, status: "removed" });
      else if (prev && curr && prev.hash !== curr.hash) items.push({ kind: "panel", id, label, status: "modified" });
    }
    const projectionIds = new Set([...Object.keys(baseline.projections), ...Object.keys(live.projections)]);
    for (const id of [...projectionIds].sort()) {
      const prev = baseline.projections[id];
      const curr = live.projections[id];
      const label = labels.projectionLabels?.get(id) ?? id;
      if (!prev && curr) items.push({ kind: "projection", id, label, status: "added" });
      else if (prev && !curr) items.push({ kind: "projection", id, label, status: "removed" });
      else if (prev && curr && prev.hash !== curr.hash) items.push({ kind: "projection", id, label, status: "modified" });
    }
  }

  return { hasDrift: items.length > 0, items };
}

/** Collects all domain panel IDs directly referenced by an application's frame, entries, or delivery list. */
export function applicationDirectPanelIds(application: Pick<ApplicationSourceManifest, "framePanelId" | "panelUses" | "delivery">): string[] {
  const ids = new Set<string>();
  if (application.framePanelId) ids.add(application.framePanelId);
  for (const use of application.panelUses) {
    if (isApplicationPanelUse(use)) ids.add(use.panelId);
  }
  for (const panelId of application.delivery?.panels ?? []) ids.add(panelId);
  return [...ids].sort();
}

export function panelDirectReferences(panel: Pick<ProductPanelInput, "manifest">): { panelIds: string[]; projectionIds: string[] } {
  const panelIds = new Set<string>();
  const projectionIds = new Set<string>();
  for (const { target } of Object.values(panel.manifest.members)) {
    if ("panelId" in target) panelIds.add(target.panelId);
    else if ("projectionId" in target) projectionIds.add(target.projectionId);
    else if ("candidates" in target) {
      if ("panelIds" in target.candidates) for (const id of target.candidates.panelIds) panelIds.add(id);
      if ("projectionIds" in target.candidates) for (const id of target.candidates.projectionIds) projectionIds.add(id);
    }
  }
  return { panelIds: [...panelIds].sort(), projectionIds: [...projectionIds].sort() };
}

export function normalizePanelUsesForSource(uses: readonly ApplicationPanelUse[]): ApplicationPanelUse[] {
  return uses.map(use => applicationPanelUseSchema.parse(use));
}
