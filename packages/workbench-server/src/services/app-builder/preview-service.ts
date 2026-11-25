import { z } from "zod";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { BuildTestContext } from "@ontomato/contracts/build-tests";
import type { AppCandidatePanelSource, ProductPanelNestedReadRequest } from "@ontomato/contracts/panel-host";
import {
  isApplicationPanelUse,
  panelDefinitionContentSchema,
  type PanelDefinitionContent,
  type ProductPanelInput,
  type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { workspaceCommitSchema, workspaceExportSchema, type WorkspaceFile } from "@ontomato/contracts/workspaces";
import { resolveLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { issueHostedPreviewToken } from "../workspaces/preview-tokens";
import type { AssistantOwner } from "../assistant/store";
import { readPanelDomainComponents } from "../product-panels/component-catalogue";
import { readCurrentPanelRecord, readCurrentProjectionRecord } from "../product-panels/current";
import { resolvePanelMemberPath } from "../product-panels/member-path";
import { WorkspaceBuildTests } from "./build-tests";
import { authorizeBuilderProject, type BuilderPreviewEntry } from "./project-service";
import { appWorkspaceSlot } from "./project-store";
import {
  parseApplicationSource,
  serializeApplicationSource,
  type ParsedApplicationSource,
} from "./source-codec";

export const appPreviewQuerySchema = z.object({
  ref: z.union([z.literal("working"), workspaceCommitSchema]).default("working"),
  entryId: z.string().min(1).optional(),
}).strict();

export type AppPreviewDescriptor =
  | {
      kind: "empty";
      appId: string;
      materialized: boolean;
      workspaceId: string | null;
      entries: BuilderPreviewEntry[];
      activeEntryId: null;
      previewContext: { kind: "build-test"; test: BuildTestContext | null };
    }
  | {
      kind: "hosted";
      appId: string;
      materialized: boolean;
      workspaceId: string | null;
      entries: BuilderPreviewEntry[];
      activeEntryId: null;
      hostedPreviewUrl: string;
      expiresAt: string | null;
      previewContext: { kind: "build-test"; test: BuildTestContext | null };
    }
  | {
      kind: "panel";
      appId: string;
      materialized: boolean;
      workspaceId: string | null;
      entries: BuilderPreviewEntry[];
      activeEntryId: string;
      candidate: AppCandidatePanelSource;
    };

interface LoadedPreviewSource {
  appId: string;
  materialized: boolean;
  workspaceId: string | null;
  ref: "working" | string;
  parsed: ParsedApplicationSource;
  test: BuildTestContext | null;
  hostedReleaseId: string | null;
}

async function readAllWorkingFiles(
  runtime: ReturnType<typeof import("./project-service").appRuntimeClient>,
  workspaceId: string,
  ref: "working" | string,
): Promise<WorkspaceFile[]> {
  if (ref !== "working") {
    const exported = workspaceExportSchema.parse(
      await runtime.request(`/v1/workspaces/${workspaceId}/export`, "POST", { commit: ref }),
    );
    return exported.files;
  }
  const tree = z.object({ files: z.array(z.object({ path: z.string() })) }).parse(
    await runtime.request(`/v1/workspaces/${workspaceId}/tree`),
  );
  const files: WorkspaceFile[] = [];
  for (const entry of tree.files) {
    if (entry.path.startsWith("test-data/")) continue;
    const bytes = await runtime.bytes(`/v1/workspaces/${workspaceId}/files/content?${new URLSearchParams({ path: entry.path })}`);
    files.push({ path: entry.path, encoding: "utf8", content: bytes.toString("utf8") });
  }
  return files;
}

async function loadPreviewSource(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  ref: "working" | string,
): Promise<LoadedPreviewSource> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId);
  if (ctx.project) {
    const workspaceId = ctx.project.workspaceId;
    const tests = new WorkspaceBuildTests(owner, credentials, workspaceId, appWorkspaceSlot(appId));
    const [files, test] = await Promise.all([
      readAllWorkingFiles(ctx.runtime, workspaceId, ref),
      tests.current(),
    ]);
    return {
      appId,
      materialized: true,
      workspaceId,
      ref,
      parsed: parseApplicationSource(files),
      test,
      hostedReleaseId: ctx.live?.snapshot.kind === "hosted" ? ctx.live.snapshot.releaseId : null,
    };
  }

  // Unmaterialized published application: derive source in memory with zero writes (Standard §4.3).
  if (ctx.live?.snapshot.kind === "panel") {
    const files = serializeApplicationSource(ctx.live.snapshot);
    return {
      appId,
      materialized: false,
      workspaceId: null,
      ref: "working",
      parsed: parseApplicationSource(files),
      test: null,
      hostedReleaseId: null,
    };
  }

  if (ctx.live?.snapshot.kind === "hosted") {
    return {
      appId,
      materialized: false,
      workspaceId: null,
      ref: "working",
      parsed: { kind: "hosted", hasIndexHtml: true },
      test: null,
      hostedReleaseId: ctx.live.snapshot.releaseId,
    };
  }

  return {
    appId,
    materialized: false,
    workspaceId: null,
    ref: "working",
    parsed: { kind: "empty" },
    test: null,
    hostedReleaseId: null,
  };
}

function selectPanelFromSource(
  source: LoadedPreviewSource,
  locale: string | undefined,
  requestedEntryId?: string,
): {
  entries: BuilderPreviewEntry[];
  activeEntryId: string;
  panel: PanelDefinitionContent;
  sourcePanels: Map<string, ProductPanelInput>;
  sourceProjections: Map<string, ProductProjectionInput>;
} | null {
  if (source.parsed.kind === "legacy-single-panel") {
    return {
      entries: [{ id: "preview", panelId: "preview", label: "Preview", path: "/" }],
      activeEntryId: "preview",
      panel: source.parsed.panel,
      sourcePanels: new Map(),
      sourceProjections: new Map(),
    };
  }
  if (source.parsed.kind !== "panel-app") return null;

  const sourcePanels = new Map(source.parsed.panels.map(p => [p.id, p.input]));
  const sourceProjections = new Map(source.parsed.projections.map(p => [p.id, p.input]));
  const loc = resolveLocale(locale);
  const entries: BuilderPreviewEntry[] = source.parsed.application.panelUses
    .filter(isApplicationPanelUse)
    .map(use => ({
      id: use.id,
      panelId: use.panelId,
      label: (use.names && localizedApplicationText(use.names, loc)) || use.pageKey,
      path: use.path,
    }));

  if (!entries.length) return null;
  const home = source.parsed.application.entry.home;
  const chosen = (requestedEntryId ? entries.find(e => e.id === requestedEntryId) : undefined)
    ?? entries.find(e => e.path === home)
    ?? entries[0]!;

  const localPanel = sourcePanels.get(chosen.panelId);
  if (!localPanel) {
    return null;
  }
  const panel = panelDefinitionContentSchema.parse({
    manifest: localPanel.manifest,
    content: localPanel.content,
  });
  return {
    entries,
    activeEntryId: chosen.id,
    panel,
    sourcePanels,
    sourceProjections,
  };
}

/**
 * Resolves the authoritative preview descriptor for an application (`AppPreview` host backend).
 * All authorization and source resolution is owned here by the application owner; the SDK component
 * never guesses identity, tokens, or workspace slots.
 */
export async function readApplicationPreviewDescriptor(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  query: { ref?: "working" | string; entryId?: string },
): Promise<AppPreviewDescriptor> {
  const ref = query.ref ?? "working";
  const source = await loadPreviewSource(owner, credentials, appId, ref);

  if (source.parsed.kind === "empty") {
    return {
      kind: "empty",
      appId,
      materialized: source.materialized,
      workspaceId: source.workspaceId,
      entries: [],
      activeEntryId: null,
      previewContext: { kind: "build-test", test: source.test },
    };
  }

  if (source.parsed.kind === "hosted") {
    if (source.workspaceId) {
      const issued = await issueHostedPreviewToken(owner, credentials, source.workspaceId, appWorkspaceSlot(appId));
      return {
        kind: "hosted",
        appId,
        materialized: true,
        workspaceId: source.workspaceId,
        entries: [],
        activeEntryId: null,
        hostedPreviewUrl: `/api/workspaces/${source.workspaceId}/preview/${issued.token}/index.html`,
        expiresAt: issued.expiresAt,
        previewContext: { kind: "build-test", test: source.test },
      };
    }
    if (source.hostedReleaseId) {
      return {
        kind: "hosted",
        appId,
        materialized: false,
        workspaceId: null,
        entries: [],
        activeEntryId: null,
        hostedPreviewUrl: `/apps/${encodeURIComponent(appId)}/index.html`,
        expiresAt: null,
        previewContext: { kind: "build-test", test: null },
      };
    }
    return {
      kind: "empty",
      appId,
      materialized: false,
      workspaceId: null,
      entries: [],
      activeEntryId: null,
      previewContext: { kind: "build-test", test: null },
    };
  }

  const selected = selectPanelFromSource(source, credentials.locale, query.entryId);
  if (!selected) {
    // Entry references a live panel (e.g. builtin or foreign-owned panel) not in local panels/.
    if (source.parsed.kind === "panel-app") {
      const loc = resolveLocale(credentials.locale);
      const entries: BuilderPreviewEntry[] = source.parsed.application.panelUses
        .filter(isApplicationPanelUse)
        .map(use => ({
          id: use.id,
          panelId: use.panelId,
          label: (use.names && localizedApplicationText(use.names, loc)) || use.pageKey,
          path: use.path,
        }));
      if (entries.length > 0) {
        const chosen = (query.entryId ? entries.find(e => e.id === query.entryId) : undefined) ?? entries[0]!;
        const livePanel = await readCurrentPanelRecord(owner, credentials, chosen.panelId);
        const panel = panelDefinitionContentSchema.parse({
          manifest: livePanel.manifest,
          content: livePanel.content,
        });
        const domainComponents = await readPanelDomainComponents(
          { domainId: livePanel.domainId, credentials },
          panel.manifest.components,
        );
        return {
          kind: "panel",
          appId,
          materialized: source.materialized,
          workspaceId: source.workspaceId,
          entries,
          activeEntryId: chosen.id,
          candidate: {
            kind: "app-candidate",
            app: { id: appId, ref: source.ref, entryId: chosen.id },
            panel,
            ...(domainComponents && { domainComponents }),
            previewContext: { kind: "build-test", test: source.test },
          },
        };
      }
    }
    return {
      kind: "empty",
      appId,
      materialized: source.materialized,
      workspaceId: source.workspaceId,
      entries: [],
      activeEntryId: null,
      previewContext: { kind: "build-test", test: source.test },
    };
  }

  // Validate references to external (non-local) panels and projections.
  const externalProjectionIds = new Set<string>();
  const externalPanelIds = new Set<string>();
  for (const { target } of Object.values(selected.panel.manifest.members)) {
    if ("projectionId" in target && !selected.sourceProjections.has(target.projectionId)) {
      externalProjectionIds.add(target.projectionId);
    }
    if ("panelId" in target && !selected.sourcePanels.has(target.panelId)) {
      externalPanelIds.add(target.panelId);
    }
  }
  await Promise.all([
    ...[...externalProjectionIds].map(id => readCurrentProjectionRecord(owner, credentials, id)),
    ...[...externalPanelIds].map(id => readCurrentPanelRecord(owner, credentials, id)),
  ]);

  const domainComponents = await readPanelDomainComponents(
    { domainId: owner.domainId, credentials },
    selected.panel.manifest.components,
  );

  return {
    kind: "panel",
    appId,
    materialized: source.materialized,
    workspaceId: source.workspaceId,
    entries: selected.entries,
    activeEntryId: selected.activeEntryId,
    candidate: {
      kind: "app-candidate",
      app: { id: appId, ref: source.ref, entryId: selected.activeEntryId },
      panel: selected.panel,
      ...(domainComponents && { domainComponents }),
      previewContext: { kind: "build-test", test: source.test },
    },
  };
}

/** Resolve candidate and live references through the same placement rules as a registered panel. */
export async function resolveApplicationPreviewPath(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  query: { ref?: "working" | string; entryId?: string },
  memberPath: ProductPanelNestedReadRequest["memberPath"],
) {
  const source = await loadPreviewSource(owner, credentials, appId, query.ref ?? "working");
  const selected = selectPanelFromSource(source, credentials.locale, query.entryId);
  let rootPanel = selected?.panel;
  if (!rootPanel && source.parsed.kind === "panel-app") {
    const { panelUses: uses, entry } = source.parsed.application;
    const panelEntries = uses.filter(isApplicationPanelUse);
    const chosen = panelEntries.find(use => use.id === query.entryId)
      ?? panelEntries.find(use => use.path === entry.home)
      ?? panelEntries[0];
    if (chosen) rootPanel = await readCurrentPanelRecord(owner, credentials, chosen.panelId);
  }
  if (!rootPanel) throw new HttpError(404, "No previewable panel found for this application", "NOT_FOUND");

  const panels = source.parsed.kind === "panel-app" ? new Map(source.parsed.panels.map(p => [p.id, p.input])) : new Map<string, ProductPanelInput>();
  const projections = source.parsed.kind === "panel-app" ? new Map(source.parsed.projections.map(p => [p.id, p.input])) : new Map<string, ProductProjectionInput>();
  const now = new Date().toISOString();
  const placement = await resolvePanelMemberPath(owner, credentials, rootPanel, memberPath, undefined, undefined, undefined, ({ kind, id }) => {
    const input = (kind === "panel" ? panels : projections).get(id);
    return input && { ...input, id, domainId: owner.domainId, ownerId: owner.userId,
      revision: 0, createdAt: now, updatedAt: now, editable: true };
  });
  return { ...placement, previewContext: { kind: "build-test" as const, test: source.test } };
}

export async function resolveApplicationPreviewMember(...args: Parameters<typeof resolveApplicationPreviewPath>) {
  const placement = await resolveApplicationPreviewPath(...args);
  if (placement.kind !== "projection") {
    throw new HttpError(403, "The member path does not select a projection", "PANEL_MEMBER_FORBIDDEN");
  }
  return placement;
}
