import { loadDomainComponent } from "./domain-component";
import { ApiRequestError, nodeApiRequest } from "@ontomato/workbench-ui";
import {
  applicationEntryResolutionQuerySchema, applicationOpenResponseSchema, productPanelResponseSchema, productPanelSchema,
  isApplicationPanelUse,
  type FrameConversationEntry,
  type ApplicationEntryResolutionQuery, type ApplicationOpenResponse, type ApplicationPanelUse,
  type BundledPanelProjection, type ProductPanel, type ProductPanelResponse,
} from "@ontomato/contracts/product-panels";
import { appsSdkCurrentSchema, appsSdkReleaseManifestSchema } from "@ontomato/contracts/apps-sdk";
import {
  panelDefinitionSnapshotSchema, productDefinitionStreamFrameSchema,
  type ProductDefinitionRevision, type ProductDefinitionTarget,
} from "@ontomato/contracts/product-subscriptions";
import {
  appCandidatePanelSourceSchema, candidatePanelSourceSchema, PANEL_NESTED_READ_PATH, PANEL_PERSONAL_STATE_PATH, PANEL_PERSONAL_STATE_READ_PATH,
  PANEL_READ_BATCH_MAX, PANEL_READ_BATCH_PATH,
  panelPersonalStateResponseSchema, productPanelNestedReadResponseSchema, productPanelReadBatchResponseSchema, productPanelReadResponseSchema,
  type AppCandidatePanelSource, type PanelCurrentUser, type ProductPanelNestedReadRequest,
  type CandidatePanelSource, type DirectPanelHostSource, type PanelHostSource, type PanelAuthorDefinitions, type PanelDefinitionMode,
  type ProductPanelReadRequest, type ProductPanelReadResponse,
} from "@ontomato/contracts/panel-host";
import { panelModuleSpecifiers } from "@ontomato/contracts/panel-module";
import { PREVIEW_WRITE_FORBIDDEN, PREVIEW_WRITE_MESSAGE } from "@ontomato/contracts/execution-context";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import { readSseData, sseReconnectDelay } from "@ontomato/contracts/sse";
import { confirmPanelIntent, expandDeclaredComposer, hostThemeMode, platformRouter, registerCandidateFrame, registerPanelFrame, servePageComposer } from "./app-host";
import { panelNavigator } from "./panel-navigate";
import {
  adoptPanelStyle, applyTheme, codedPanelTarget, composeThemes, createPanelOverlayRoot, newPanelInstanceName, scopedPanelStyle,
  type CodedPanelTarget, type DirectPanelRun, type PanelHostPort, type PanelHostState, type PanelSdkRelease,
} from "@ontomato/platform-shell";
import { candidateProjectionIds, type PanelManifest, type PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import {
  memberComponentId, panelModuleFor, PanelMemberUnavailable, panelPreviewHostKey, preloadCatalogueComponents, readProjectionForRender,
  type DirectPanelMount as PanelRunMount, type DirectPanelMountOptions, type PlatformRequests,
} from "@ontomato/apps-sdk/direct";
import {
  currentDefinitionCacheScope, framePanelCacheKey, getCachedPanel, getCachedProjection, ingestBundledPanelProjections,
  invalidateCachedPanel, invalidateCachedPanelById, invalidateCachedProjection, readCachedProjection,
  reconcileDefinitionCacheWithSnapshot, reconcileMountProjectionBundle, setCachedPanel, type MountProjectionBundle,
} from "./panel-definition-cache";
import { workbenchI18n, workbenchLanguage } from "@ontomato/workbench-ui/i18n";
import { authHost } from "@ontomato/workbench-ui/utils/auth";
import { platformLocalDraftStore } from "./local-draft-store";
import type { Router } from "vue-router";
import * as Vue from "vue";
import { provideGlobalConfig } from "element-plus";
import { runPanelModule, useTemplateCompiler } from "./panel-module";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import {
  pageCounterKey, panelChatHostKey, pageSessionStream, servePageComposerKey, sessionRunNotices,
  type DisplayObjectChange, type PageCounter, type PanelChatHost,
} from "@ontomato/agent-shell-ui";
import type { PanelSessionFeed } from "./panel-session-runs";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { createPanelPreviewHost } from "./panel-preview";

/*
 * The platform's panel host (overall design 3.4): the two reads a panel instance needs and the notices it listens to.
 *
 * - A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`); the application and its
 *   permissions stay there.
 * - A panel's current record is Node's (`GET /api/product-panels/:id`), read outside the frame under the reader's own
 *   credential; a projection's record is read inside the frame by the projection itself.
 * - An author's workspace candidate is Node's too (`GET /api/workspaces/:id/panel-candidate?ref=`), under the author's
 *   workspace access. It is the same host with another source: no use relation, panel ID or revision of its own, and a
 *   preview execution identity instead of a live one.
 * - Viewers reconcile revisions using short requests. Author hosts share the document's definition stream.
 */

/**
 * The addresses the panel host reads, each at its own owner. Java answers the use relations, under the gateway's
 * data-query prefix; Node answers panels, subscriptions and the SDK's current version, at `/api` with no such prefix. They
 * are named here once, and a test asserts them, because an address assembled from the wrong owner's habit is a 403 that
 * looks like a permission problem.
 */
export const panelHostPaths = {
  appsSdkCurrent: "/api/apps-sdk/current",
  applicationPanelUses: (applicationId: string) =>
    `/api/data-query/platform/applications/${encodeURIComponent(applicationId)}/panel-uses`,
  panel: (panelId: string) => `/api/product-panels/${encodeURIComponent(panelId)}`,
  snapshot: (panelId: string) => `/api/product-panels/${encodeURIComponent(panelId)}/snapshot`,
  definitionStream: "/api/product-panels/definition-stream",
  /** What a panel's member shows: one named datum, read by the platform as the reader. */
  read: "/api/product-panels/read",
  readBatch: `/api${PANEL_READ_BATCH_PATH}`,
  candidate: (workspaceId: string, ref: string) =>
    `/api/workspaces/${encodeURIComponent(workspaceId)}/panel-candidate?${new URLSearchParams({ ref })}`,
};

async function json(path: string, init: RequestInit = {}) {
  const response = await nodeApiRequest(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${path}`);
  return body;
}

/**
 * The deployment's one current SDK release, which a panel written with code runs on in its frame: Node names it and
 * where its files are, and its manifest names the modules and the stylesheet the frame loads.
 */
async function release(): Promise<PanelSdkRelease> {
  const current = appsSdkCurrentSchema.parse(await json(panelHostPaths.appsSdkCurrent));
  const manifest = await fetch(current.manifestPath);
  if (!manifest.ok) throw new Error(`The SDK release manifest could not be read: ${current.manifestPath}`);
  return { base: current.sdkBasePath, manifest: appsSdkReleaseManifestSchema.parse(await manifest.json()) };
}

/** A panel's current record (unbundled, uncached — used for author previews and auxiliary reads). */
async function panel(panelId: string) {
  return productPanelSchema.parse((await json(panelHostPaths.panel(panelId))).panel);
}

interface PendingPanelRead {
  request: ProductPanelReadRequest;
  independent?: true;
  resolve: (result: ProductPanelReadResponse) => void;
  reject: (error: unknown) => void;
}
const pendingPanelReads: PendingPanelRead[] = [];

function panelReadBatchKey(request: ProductPanelReadRequest): string {
  const { source } = request;
  const identity = source.kind === "candidate"
    ? [source.kind, source.workspace.id, source.workspace.ref]
    : source.kind === "app-candidate"
      ? [source.kind, source.app.id, source.app.ref, source.app.entryId]
      : [source.kind, source.applicationId, source.useId];
  // ObjectList renders its primary rows while the supplement is still loading.
  const supplement = "dataName" in request && request.dataName === "supplement";
  return JSON.stringify([...identity, supplement]);
}

function flushPendingPanelReads() {
  const reads = pendingPanelReads.splice(0);
  const buckets = new Map<string, PendingPanelRead[]>();
  const independent: PendingPanelRead[][] = [];
  for (const item of reads) {
    if (item.independent) {
      independent.push([item]);
      continue;
    }
    const key = panelReadBatchKey(item.request);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  for (const bucket of [...buckets.values(), ...independent]) {
    for (let offset = 0; offset < bucket.length; offset += PANEL_READ_BATCH_MAX) {
      const chunk = bucket.slice(offset, offset + PANEL_READ_BATCH_MAX);
      void sendPanelReads(chunk).catch(error => {
        for (const item of chunk) item.reject(error);
      });
    }
  }
}

async function sendPanelReads(chunk: PendingPanelRead[]) {
  if (chunk.length === 1) {
    const [item] = chunk;
    const result = await json(panelHostPaths.read, { method: "POST", body: JSON.stringify(item.request) });
    item.resolve(productPanelReadResponseSchema.parse(result));
    return;
  }
  const result = await json(panelHostPaths.readBatch, {
    method: "POST", body: JSON.stringify({ reads: chunk.map(item => item.request) }),
  });
  const { results } = productPanelReadBatchResponseSchema.parse(result);
  if (results.length !== chunk.length) throw new Error("Panel read batch response count does not match the request");
  chunk.forEach((item, index) => item.resolve(results[index]));
}

/** One named datum a panel's member shows, read by the platform as the reader, in one of its four states. */
export function readPanelData(request: ProductPanelReadRequest): Promise<ProductPanelReadResponse> {
  return queuePanelRead(request);
}

function queuePanelRead(request: ProductPanelReadRequest, independent?: true): Promise<ProductPanelReadResponse> {
  return new Promise((resolve, reject) => {
    pendingPanelReads.push({ request, independent, resolve, reject });
    if (pendingPanelReads.length === 1) queueMicrotask(flushPendingPanelReads);
  });
}

async function snapshot(panelId: string) {
  return panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(panelId)));
}

/**
 * A change to objects a panel shows, as the page showing it hears of it: from the conversation's session stream (an
 * agent's write, an operation that finished later) or from Node's receipt for an operation the reader confirmed in this
 * frame. The page re-reads what its shown instance displays of the target — everything it displays when there is none —
 * and, when the owner says which object types changed, the counts that count them. The conversation's display owns the
 * shape; this is its name on the panel host's side.
 */
export type PanelObjectChange = DisplayObjectChange;

function panelProjectionComponentIds(
  manifest: PanelManifest,
  bundled?: Record<string, BundledPanelProjection>,
): string[] {
  const ids = new Set<string>();
  for (const member of Object.values(manifest.members)) {
    if (!("projectionId" in member.target)) continue;
    const entry = bundled?.[member.target.projectionId];
    const projection = entry?.status === "ready"
      ? entry.projection
      : getCachedProjection(member.target.projectionId)?.projection;
    if (projection) ids.add(memberComponentId(projection));
  }
  return [...ids];
}

function warmPanelProjectionComponents(manifest: PanelManifest, bundled?: Record<string, BundledPanelProjection>) {
  const ids = panelProjectionComponentIds(manifest, bundled);
  if (ids.length) void preloadCatalogueComponents(ids);
}

function hasProjectionCandidates(manifest: PanelManifest) {
  return Object.values(manifest.members).some(({ target }) => candidateProjectionIds(target).length > 0);
}

/** Checks whether a panel declares an inline `ConversationEntry` member so the route avoids a duplicate bottom composer. */
export function panelHasInlineConversationEntry(
  panel: Pick<ProductPanel, "manifest" | "content">,
  projections?: Readonly<Record<string, BundledPanelProjection>> | readonly BundledPanelProjection[],
): boolean {
  const projectionList = Array.isArray(projections) ? projections : projections ? Object.values(projections) : [];
  if (projectionList.length) {
    const fixedIds = new Set(Object.values(panel.manifest.members).flatMap(({ target }) =>
      "projectionId" in target ? [target.projectionId] : [],
    ));
    if (projectionList.some((entry) =>
      entry.status === "ready" && fixedIds.has(entry.projection.id)
      && (entry.projection.componentId === "@ontomato/sdk:ConversationEntry" || entry.projection.componentId === "ConversationEntry")
      && entry.projection.config?.presentation === "inline",
    )) {
      return true;
    }
  }
  for (const member of Object.values(panel.manifest.members ?? {})) {
    const raw = member as Record<string, unknown>;
    const component = typeof raw.component === "string" ? raw.component : "";
    const config = raw.config && typeof raw.config === "object" ? (raw.config as Record<string, unknown>) : null;
    if (
      (component === "ConversationEntry" || component === "@ontomato/sdk:ConversationEntry")
      && config?.presentation === "inline"
    ) {
      return true;
    }
  }
  const html = panel.content?.html ?? "";
  return /<(?:projection|conversation-entry)\b[^>]*\bpresentation\s*=\s*["']inline["']/i.test(html);
}

/** Frame composer ownership follows the frame's fixed projections. */
export function panelHasAgentChat(panel: ProductPanel, projections?: Record<string, BundledPanelProjection>) {
  return panelProjectionComponentIds(panel.manifest, projections)
    .some(id => id === "@ontomato/sdk:AgentChat" || id === "AgentChat");
}

/**
 * The platform's panel host for one use relation of the application whose page is showing it. `changed` is that page's:
 * a change its frame's operations report reaches the page through it.
 */
export function platformPanelHost(
  applicationId: string, use: ApplicationPanelUse, changed: (change: PanelObjectChange) => void, mode: PanelDefinitionMode = { kind: "view" },
  /** Beside a conversation, the conversation's display, which opens an address the panel asks for; at full page, none. */
  beside?: (address: string) => void,
  /** Platform page counter provided by the outer layout, bridged into direct-mounted panel Vue apps for inline composers. */
  pageCounter?: PageCounter | null,
  /** Optional hook called while an embedded AgentChat is mounted so the page suppresses its bottom PageComposer. */
  claimComposer?: () => () => void,
  /** Notified whenever the entry panel (and any bundled projections) is loaded so the route can inspect composer metadata. */
  onPanelLoaded?: (loaded: ProductPanel, projections?: Readonly<Record<string, BundledPanelProjection>>) => void,
  display?: PanelChatHost["display"],
  feed?: PanelSessionFeed,
  /** Bundled content panel definition returned with the opening response, consumed once on initial mount. */
  initialPanel?: ProductPanelResponse | null,
): PanelHostPort<Extract<PanelHostSource | DirectPanelHostSource, { kind: "registered" }>> {
  const panelChatHost = createPanelChatHost(use.defaultAgent, { claimComposer, display });
  const shown: PanelUseRef = { applicationId, useId: use.id };
  const personalSource = { kind: "registered", ...shown } as const;
  const query = new URLSearchParams({ includeProjections: "1" });
  if (mode.kind === "view") query.set("view", "1");
  if (Object.values(use.inputs ?? {}).some(input => "frameState" in input || typeof input.literal === "object")) {
    query.set("source", "registered");
    query.set("applicationId", applicationId);
    query.set("useId", use.id);
  }
  const bundleQuery = `?${query}`;
  const controlled = new Set(Object.keys(use.inputs ?? {}));
  let pendingPersonalState: PersonalStateRead | undefined;
  let initialContent = initialPanel && initialPanel.panel.id === use.panelId ? initialPanel : null;
  let lastPanel: ProductPanel | undefined;
  let mountBundle: MountProjectionBundle | undefined;
  let panelDomainComponents: Record<string, import("@ontomato/contracts/domain-components").DomainComponentRuntime> | undefined;
  let sourceReconciled = false;
  const nestedSnapshots = new Set<() => Promise<void>>();
  return {
    // After entry admission, render the panel and its bundled projections under the reader's current use grants.
    async source() {
      warmTemplateCompiler();
      pendingPersonalState = undefined;
      sourceReconciled = false;
      if (initialContent) {
        const answer = initialContent;
        initialContent = null;
        const scope = currentDefinitionCacheScope();
        setCachedPanel(use.panelId, answer.panel, scope);
        mountBundle = ingestBundledPanelProjections(answer.projections, scope);
        warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
        panelDomainComponents = answer.domainComponents;
        lastPanel = answer.panel;
        sourceReconciled = true;
        onPanelLoaded?.(answer.panel, answer.projections);
        return { kind: "registered", applicationId, use, panel: answer.panel };
      }
      {
        const cached = getCachedPanel(use.panelId);
        if (cached && !hasProjectionCandidates(cached.manifest)) {
          warmPanelProjectionComponents(cached.manifest);
          const fields = personalFields(cached.manifest, controlled);
          if (fields.length) {
            pendingPersonalState = {
              fieldKey: personalFieldKey(fields),
              response: readPersonalState({ source: personalSource, memberPath: [] }, fields),
            };
          }
          // Verify panel access and definition revisions before mounting a cached record.
          const scope = currentDefinitionCacheScope();
          let verified;
          try {
            verified = panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(use.panelId)));
          } catch (failure) {
            invalidateCachedPanel(use.panelId);
            throw failure;
          }
          const forbidden = reconcileDefinitionCacheWithSnapshot(use.panelId, cached, verified, scope);
          if (verified.panel.revision === cached.revision) {
            lastPanel = cached;
            mountBundle = forbidden;
            sourceReconciled = true;
            const cachedProjections: Record<string, BundledPanelProjection> = {};
            for (const member of Object.values(cached.manifest.members)) {
              if ("target" in member && "projectionId" in member.target) {
                const entry = getCachedProjection(member.target.projectionId);
                if (entry) cachedProjections[member.target.projectionId] = { status: "ready", projection: entry.projection };
              }
            }
            onPanelLoaded?.(cached, cachedProjections);
            return { kind: "registered", applicationId, use, panel: cached };
          }
          invalidateCachedPanel(use.panelId);
          sourceReconciled = true;
        }
        const scope = currentDefinitionCacheScope();
        const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(use.panelId)}${bundleQuery}`));
        setCachedPanel(use.panelId, answer.panel, scope);
        mountBundle = ingestBundledPanelProjections(answer.projections, scope);
        warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
        panelDomainComponents = answer.domainComponents;
        lastPanel = answer.panel;
        sourceReconciled = true;
        onPanelLoaded?.(answer.panel, answer.projections);
        return { kind: "registered", applicationId, use, panel: answer.panel };
      }
    },
    sourceReconciled: () => sourceReconciled,
    pageKey: use.pageKey,
    use: shown,
    async panel(panelId) {
      if (panelId === use.panelId) {
        const scope = currentDefinitionCacheScope();
        const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(panelId)}${bundleQuery}`));
        setCachedPanel(panelId, answer.panel, scope);
        mountBundle = ingestBundledPanelProjections(answer.projections, scope);
        lastPanel = answer.panel;
        return answer.panel;
      }
      return panel(panelId);
    },
    release,
    // The frame is this application's: the address the reader is on names it, and a panel shown beside a conversation is
    // the same application's page. Registering it under that ID is what lets the bridge recognise the frame and answer
    // its `connect`, and what keeps a frame of another application from being mistaken for this one. What it may ask for
    // is what the panel's record declares, for this use relation's page.
    frame: (frame, source, open) => registerPanelFrame(frame, shown, { pageKey: use.pageKey, manifest: source.panel.manifest }, open, changed),
    // The panel runs in this document, as the same application's page: its members read through the platform as the
    // reader, within this use, and a person's write is confirmed and dispatched here.
    coded: (source, run, target) => {
      const entryPanel = source.panel.id === use.panelId;
      const pending = pendingPersonalState;
      pendingPersonalState = undefined;
      const mount = (opened: DirectPanelRun) => mountCoded(withNested({
        ...directOptions(source, opened, shown, changed, beside, undefined, undefined, mountBundle),
        ...(panelDomainComponents ? { panelDomainComponents } : {}),
      }, personalSource, pageCounter, panelChatHost, feed, nestedSnapshots), target, source.panel.content.module, pageCounter, panelChatHost, feed);
      return withPersonalState(personalSource, [], source.panel.manifest, run, mount,
        entryPanel ? controlled : new Set(), entryPanel ? pending : undefined);
    },
    async snapshot(panelId) {
      const scope = currentDefinitionCacheScope();
      let answer;
      try {
        answer = panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(panelId)));
      } catch (failure) {
        invalidateCachedPanel(panelId);
        throw failure;
      }
      const forbidden = reconcileDefinitionCacheWithSnapshot(panelId, lastPanel, answer, scope);
      reconcileMountProjectionBundle(mountBundle, answer, forbidden);
      await Promise.all([...nestedSnapshots].map(read => read()));
      return answer;
    },
    mode,
  };
}

async function reconcileCachedApplicationFrame(
  cacheKey: string, framePanelId: string, query: URLSearchParams,
) {
  const cached = getCachedPanel(cacheKey);
  if (!cached || hasProjectionCandidates(cached.manifest)) return;
  const scope = currentDefinitionCacheScope();
  let verified;
  try {
    verified = panelDefinitionSnapshotSchema.parse(await json(`${panelHostPaths.snapshot(framePanelId)}?${query}`));
  } catch (failure) {
    invalidateCachedPanel(cacheKey);
    throw failure;
  }
  const forbidden = reconcileDefinitionCacheWithSnapshot(cacheKey, cached, verified, scope);
  return { panel: verified.panel.revision === cached.revision ? cached : undefined, forbidden };
}

export interface FrameChatOptions {
  display: NonNullable<PanelChatHost["display"]>;
  claimComposer: NonNullable<PanelChatHost["claimComposer"]>;
  feed: PanelSessionFeed;
  onPanelLoaded(ownsComposer: boolean): void;
}

function reportFrameComposer(
  chat: FrameChatOptions | undefined,
  loaded: ProductPanel,
  projections?: Record<string, BundledPanelProjection>,
) {
  chat?.onPanelLoaded(panelHasAgentChat(loaded, projections) || panelHasInlineConversationEntry(loaded, projections));
}

/**
 * An application's own frame for the entry the reader opened (product-layer standard, part one; design §三): the panel
 * \`resolve-entry\` named as the application's \`framePanelId\`, read for that entry (\`source=frame\`) and run in this
 * document. Its members read with the frame as their root, its people's operations are bound to the frame, and Node
 * admits it by the same entry and the reader's own use of it — being the frame widens nothing. Where it shows the entry's
 * page is the run's \`currentEntry\`, which the route gives it.
 */
export function framePanelHost(
  applicationId: string, use: ApplicationPanelUse | FrameConversationEntry, framePanelId: string, changed: (change: PanelObjectChange) => void,
  router?: Router,
  chat?: FrameChatOptions,
  /** Optional one-shot provider returning the frame definition bundled in the active route opening response. */
  initialFrame?: () => Promise<ProductPanelResponse | null> | ProductPanelResponse | null,
): PanelHostPort<Extract<PanelHostSource | DirectPanelHostSource, { kind: "registered" }>> {
  const shown: PanelUseRef = { applicationId, useId: use.id };
  const frameSource: PanelReadSource = { kind: "frame", applicationId, useId: use.id } as PanelReadSource;
  const query = new URLSearchParams({ applicationId, useId: use.id, source: "frame" });
  const sourceQuery = new URLSearchParams({ applicationId, useId: use.id, source: "frame", includeProjections: "1" });
  const panelChatHost = createPanelChatHost(isApplicationPanelUse(use) ? use.defaultAgent : undefined, chat);
  const cacheKey = framePanelCacheKey(applicationId, framePanelId);
  let readInitialFrame = initialFrame;
  let lastPanel: ProductPanel | undefined;
  let mountBundle: MountProjectionBundle | undefined;
  let frameDomainComponents: Record<string, import("@ontomato/contracts/domain-components").DomainComponentRuntime> | undefined;
  let sourceReconciled = false;
  const nestedSnapshots = new Set<() => Promise<void>>();
  return {
    async source() {
      warmTemplateCompiler();
      sourceReconciled = false;
      const provided = readInitialFrame;
      readInitialFrame = undefined;
      if (provided) {
        const answer = await provided();
        if (answer) {
          const scope = currentDefinitionCacheScope();
          setCachedPanel(cacheKey, answer.panel, scope);
          mountBundle = ingestBundledPanelProjections(answer.projections, scope);
          warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
          frameDomainComponents = answer.domainComponents;
          lastPanel = answer.panel;
          reportFrameComposer(chat, answer.panel, answer.projections);
          sourceReconciled = true;
          return { kind: "registered", applicationId, use, panel: answer.panel };
        }
      }
      const reconciled = await reconcileCachedApplicationFrame(cacheKey, framePanelId, query);
      if (reconciled) {
        sourceReconciled = true;
        if (reconciled.panel) {
          lastPanel = reconciled.panel;
          mountBundle = reconciled.forbidden;
          reportFrameComposer(chat, reconciled.panel);
          return { kind: "registered", applicationId, use, panel: reconciled.panel };
        }
      }
      // Node answers the frame's record (bundled with its fixed projections) alone, with no page placement: the frame is no page of its own.
      const scope = currentDefinitionCacheScope();
      const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(framePanelId)}?${sourceQuery}`));
      setCachedPanel(cacheKey, answer.panel, scope);
      mountBundle = ingestBundledPanelProjections(answer.projections, scope);
      warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
      frameDomainComponents = answer.domainComponents;
      lastPanel = answer.panel;
      reportFrameComposer(chat, answer.panel, answer.projections);
      sourceReconciled = true;
      return { kind: "registered", applicationId, use, panel: answer.panel };
    },
    sourceReconciled: () => sourceReconciled,
    pageKey: use.pageKey,
    use: shown,
    async panel(panelId) {
      if (panelId === framePanelId) {
        const scope = currentDefinitionCacheScope();
        const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(panelId)}?${sourceQuery}`));
        setCachedPanel(cacheKey, answer.panel, scope);
        mountBundle = ingestBundledPanelProjections(answer.projections, scope);
        frameDomainComponents = answer.domainComponents;
        lastPanel = answer.panel;
        reportFrameComposer(chat, answer.panel, answer.projections);
        return answer.panel;
      }
      return panel(panelId);
    },
    release,
    frame: () => { throw new Error("An application's frame runs in the platform's document, not in a frame"); },
    coded: (source, run, target) => mountCoded(
      withNested({
        ...directOptions(source, run, shown, changed, undefined, frameSource, "frame", mountBundle, router),
        ...(frameDomainComponents ? { panelDomainComponents: frameDomainComponents } : {}),
      }, frameSource, undefined, panelChatHost, chat?.feed, nestedSnapshots),
      target, source.panel.content.module, undefined, panelChatHost, chat?.feed,
    ),
    async snapshot(panelId) {
      const scope = currentDefinitionCacheScope();
      const targetKey = panelId === framePanelId ? cacheKey : panelId;
      let answer;
      try {
        answer = panelDefinitionSnapshotSchema.parse(await json(`${panelHostPaths.snapshot(panelId)}?${query}`));
      } catch (failure) {
        invalidateCachedPanel(targetKey);
        throw failure;
      }
      const forbidden = reconcileDefinitionCacheWithSnapshot(targetKey, lastPanel, answer, scope);
      reconcileMountProjectionBundle(mountBundle, answer, forbidden);
      await Promise.all([...nestedSnapshots].map(read => read()));
      return answer;
    },
    mode: { kind: "view" },
  };
}

/**
 * A platform-shipped frame panel mounted around a built-in native application that has no registered panel entries
 * (such as System settings or Permissions): reads the platform panel record directly without a panel-use anchor and
 * renders its official navigation menu around the native route's page.
 */
export function builtinFramePanelHost(
  applicationId: string,
  framePanelId: string,
  router?: Router,
  chat?: FrameChatOptions,
  /** Optional one-shot provider returning the frame definition bundled in the active route opening response. */
  initialFrame?: () => Promise<ProductPanelResponse | null> | ProductPanelResponse | null,
): PanelHostPort<Extract<PanelHostSource | DirectPanelHostSource, { kind: "registered" }>> {
  const placeholderUse: ApplicationPanelUse = {
    id: applicationId,
    pageKey: applicationId,
    panelId: framePanelId,
    path: `/${applicationId}`,
  };
  const panelChatHost = createPanelChatHost(undefined, chat);
  const shown: PanelUseRef = { applicationId, useId: placeholderUse.id };
  const sourceQuery = new URLSearchParams({ includeProjections: "1" });
  const cacheKey = framePanelCacheKey(applicationId, framePanelId);
  let readInitialFrame = initialFrame;
  let lastPanel: ProductPanel | undefined;
  let mountBundle: MountProjectionBundle | undefined;
  let frameDomainComponents: Record<string, import("@ontomato/contracts/domain-components").DomainComponentRuntime> | undefined;
  let sourceReconciled = false;
  return {
    async source() {
      warmTemplateCompiler();
      sourceReconciled = false;
      const provided = readInitialFrame;
      readInitialFrame = undefined;
      if (provided) {
        const answer = await provided();
        if (answer) {
          const scope = currentDefinitionCacheScope();
          setCachedPanel(cacheKey, answer.panel, scope);
          mountBundle = ingestBundledPanelProjections(answer.projections, scope);
          warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
          frameDomainComponents = answer.domainComponents;
          lastPanel = answer.panel;
          reportFrameComposer(chat, answer.panel, answer.projections);
          sourceReconciled = true;
          return { kind: "registered", applicationId, use: placeholderUse, panel: answer.panel };
        }
      }
      const cached = getCachedPanel(cacheKey);
      if (cached && !hasProjectionCandidates(cached.manifest)) {
        const scope = currentDefinitionCacheScope();
        let verified;
        try {
          verified = panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(framePanelId)));
        } catch (failure) {
          invalidateCachedPanel(cacheKey);
          throw failure;
        }
        const forbidden = reconcileDefinitionCacheWithSnapshot(cacheKey, cached, verified, scope);
        if (verified.panel.revision === cached.revision) {
          lastPanel = cached;
          reportFrameComposer(chat, cached);
          mountBundle = forbidden;
          sourceReconciled = true;
          return { kind: "registered", applicationId, use: placeholderUse, panel: cached };
        }
        invalidateCachedPanel(cacheKey);
        sourceReconciled = true;
      }
      const scope = currentDefinitionCacheScope();
      const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(framePanelId)}?${sourceQuery}`));
      setCachedPanel(cacheKey, answer.panel, scope);
      mountBundle = ingestBundledPanelProjections(answer.projections, scope);
      warmPanelProjectionComponents(answer.panel.manifest, answer.projections);
      lastPanel = answer.panel;
      reportFrameComposer(chat, answer.panel, answer.projections);
      sourceReconciled = true;
      return { kind: "registered", applicationId, use: placeholderUse, panel: answer.panel };
    },
    sourceReconciled: () => sourceReconciled,
    pageKey: placeholderUse.pageKey,
    use: shown,
    async panel(panelId) {
      if (panelId === framePanelId) {
        const scope = currentDefinitionCacheScope();
        const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(panelId)}?${sourceQuery}`));
        setCachedPanel(cacheKey, answer.panel, scope);
        mountBundle = ingestBundledPanelProjections(answer.projections, scope);
        lastPanel = answer.panel;
        reportFrameComposer(chat, answer.panel, answer.projections);
        return answer.panel;
      }
      return panel(panelId);
    },
    release,
    frame: () => { throw new Error("An application's frame runs in the platform's document, not in a frame"); },
    coded: (source, run, target) => {
      const { global } = workbenchI18n();
      const navRouter = router ?? platformRouter();
      return mountCoded({
        manifest: source.panel.manifest,
        run,
        requests: platformRequests,
        readProjection: (id, readOptions) => readCachedProjection(
          id,
          () => readPlatformProjection(id),
          { mountBundle, verifyAccess: readOptions?.dynamic },
        ),
        preloadComponentIds: panelProjectionComponentIds(source.panel.manifest),
        ...(frameDomainComponents ? { panelDomainComponents: frameDomainComponents } : {}),
        use: null,
        read: () => Promise.resolve({ status: "forbidden", reason: "Native frame does not read panel data" }),
        confirmOperation: () => Promise.reject(new Error("A native frame runs no panel operations")),
        expandPageComposer: expandDeclaredComposer,
        navigate: panelNavigator(navRouter),
        messages: source.panel.content.messages ?? {},
        locale: global.locale,
        defaultLocale: String(global.fallbackLocale.value),
        translate: (key, params) => global.t(key, params ?? {}),
        currentUser: readPlatformCurrentUser,
        localDrafts: platformLocalDraftStore(),
        nested: () => { throw new Error("A native frame does not mount nested panels"); },
      }, target, source.panel.content.module, undefined, panelChatHost, chat?.feed);
    },
    async current() {
      return true;
    },
    async snapshot(panelId) {
      const scope = currentDefinitionCacheScope();
      const targetKey = panelId === framePanelId ? cacheKey : panelId;
      let answer;
      try {
        answer = panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(panelId)));
      } catch (failure) {
        invalidateCachedPanel(targetKey);
        throw failure;
      }
      const forbidden = reconcileDefinitionCacheWithSnapshot(targetKey, lastPanel, answer, scope);
      reconcileMountProjectionBundle(mountBundle, answer, forbidden);
      return answer;
    },
    mode: { kind: "view" },
  };
}

/**
 * The author's preview of a workspace candidate (design 6.2): the same host, reading the candidate instead of a use
 * relation. The preview is an author's host, so it declares author mode: the registered projections the candidate names
 * follow the document's definition stream. Its frame runs on the workspace's preview context — NONE when the
 * workspace has none — and each owner decides what such a request may do.
 */
export function candidatePanelHost(candidate: CandidatePanelSource["workspace"] & { pageKey: string }): PanelHostPort<CandidatePanelSource> {
  return {
    async source() {
      warmTemplateCompiler();
      return candidatePanelSourceSchema.parse(await json(panelHostPaths.candidate(candidate.id, candidate.ref)));
    },
    pageKey: candidate.pageKey,
    use: null,
    panel,
    release,
    frame: (frame, source, open) => registerCandidateFrame(frame, source.workspace, {
      pageKey: candidate.pageKey,
      manifest: source.panel.manifest,
    }, open),
    // A candidate runs in this document as a registered one does. It runs as no application use, so it
    // runs no operation, and its members read as the candidate's workspace.
    coded: (source, run, target) => {
      const { global } = workbenchI18n();
      return mountCoded(withNested({
        manifest: source.panel.manifest,
        run,
        requests: platformRequests,
        readProjection: readPlatformProjection,
        ...(source.domainComponents ? { panelDomainComponents: source.domainComponents } : {}),
        use: null,
        read: request => readPanelData({ source: { kind: "candidate", workspace: source.workspace }, ...request }),
        confirmOperation: () => Promise.reject(Object.assign(new Error(PREVIEW_WRITE_MESSAGE), { code: PREVIEW_WRITE_FORBIDDEN })),
        expandPageComposer: expandDeclaredComposer,
        navigate: panelNavigator(platformRouter()),
        messages: source.panel.content.messages ?? {},
        locale: global.locale,
        defaultLocale: String(global.fallbackLocale.value),
        translate: (key, params) => global.t(key, params ?? {}),
      }, { kind: "candidate", workspace: source.workspace }), target, source.panel.content.module);
    },
    snapshot,
    mode: { kind: "author", definitions: panelAuthorDefinitions() },
  };
}

/**
 * Application-scoped candidate preview host: runs a panel from an application's source (or unmaterialized live definition)
 * in author mode under preview context, reading nested members through `source.kind === "app-candidate"`.
 */
export function appCandidatePanelHost(
  initial: AppCandidatePanelSource,
  pageKey: string,
): PanelHostPort<AppCandidatePanelSource> {
  let cached: AppCandidatePanelSource | null = initial;
  const query = new URLSearchParams({ ref: initial.app.ref });
  if (initial.app.entryId) query.set("entryId", initial.app.entryId);
  const refreshPath = `/product-panels/preview/app/${encodeURIComponent(initial.app.id)}?${query}`;
  return {
    async source() {
      warmTemplateCompiler();
      if (cached !== null) {
        const current = cached;
        cached = null;
        return current;
      }
      const descriptor = await json(refreshPath) as { kind?: string; candidate?: unknown };
      if (descriptor?.kind !== "panel") {
        throw new Error("Application preview no longer resolves to a panel candidate");
      }
      return appCandidatePanelSourceSchema.parse(descriptor.candidate);
    },
    pageKey,
    use: null,
    panel,
    release,
    frame: (frame, source, open) => registerCandidateFrame(
      frame,
      { id: source.app.id, ref: source.app.ref },
      { pageKey, manifest: source.panel.manifest },
      open,
    ),
    coded: (source, run, target) => {
      const { global } = workbenchI18n();
      return mountCoded(withNested({
        manifest: source.panel.manifest,
        run,
        requests: platformRequests,
        readProjection: readPlatformProjection,
        ...(source.domainComponents ? { panelDomainComponents: source.domainComponents } : {}),
        use: null,
        read: request => readPanelData({ source: { kind: "app-candidate", app: source.app }, ...request }),
        confirmOperation: () => Promise.reject(Object.assign(new Error(PREVIEW_WRITE_MESSAGE), { code: PREVIEW_WRITE_FORBIDDEN })),
        expandPageComposer: expandDeclaredComposer,
        navigate: panelNavigator(platformRouter()),
        messages: source.panel.content.messages ?? {},
        locale: global.locale,
        defaultLocale: String(global.fallbackLocale.value),
        translate: (key, params) => global.t(key, params ?? {}),
      }, { kind: "app-candidate", app: source.app }), target, source.panel.content.module);
    },
    snapshot,
    mode: { kind: "author", definitions: panelAuthorDefinitions() },
  };
}

/**
 * The platform's requests as the reader, for a panel run in this document: the same paths a frame's SDK asks through
 * the bridge, sent here directly, Node's at `/api` and Java's under its data-query prefix.
 */
const platformRequests: PlatformRequests = {
  request: (path, init, service) => nodeApiRequest(`/api${service}${path}`, init),
};

/**
 * Reads a projection render payload through the platform's host request layer, translating HTTP 403/404
 * `ApiRequestError`s from `nodeApiRequest` into `PanelMemberUnavailable` so member slots and definition cache eviction
 * handle revoked/missing projections identically to the frame bridge.
 */
function readPlatformProjection(id: string) {
  return readProjectionForRender(platformRequests, id).catch((failure: unknown) => {
    if (failure instanceof ApiRequestError && (failure.status === 403 || failure.status === 404)) {
      throw new PanelMemberUnavailable(failure.status, failure.message);
    }
    throw failure;
  });
}

/** What a panel of an application use runs on in this document: the SDK's instance with this platform's reads, requests and words. */
function directOptions(
  source: DirectPanelHostSource, run: DirectPanelRun, use: PanelUseRef, changed: (change: PanelObjectChange) => void, beside?: (address: string) => void,
  /** Where its members read from: the entry's content (\`registered\`), or the application's frame for that entry. */
  readSource: PanelReadSource = { kind: "registered", ...use },
  /** The root its people's operations are bound to: the frame's, for a frame panel. */
  root?: "frame",
  /** The reader’s projection bundle for this mount. */
  mountBundle?: MountProjectionBundle,
  router?: Router,
): OwnPanelOptions {
  const { global } = workbenchI18n();
  return {
    manifest: source.panel.manifest,
    run,
    requests: platformRequests,
    readProjection: (id, readOptions) => readCachedProjection(
      id,
      () => readPlatformProjection(id),
      { mountBundle, verifyAccess: readOptions?.dynamic },
    ),
    preloadComponentIds: panelProjectionComponentIds(source.panel.manifest),
    use: root ? { ...use, root } : use,
    read: (request, independent) => queuePanelRead({ source: readSource, ...request }, independent),
    confirmOperation: (preparation, hooks) => confirmPanelIntent(
      use,
      preparation.intentId,
      changed,
      undefined,
      {
        ...(run.overlayRoot ? { appendTo: run.overlayRoot } : {}),
        ...(hooks?.onConfirmed ? { onConfirmed: hooks.onConfirmed } : {}),
        ...(hooks?.skipDialog ? { skipDialog: true } : {}),
      },
    ),
    expandPageComposer: expandDeclaredComposer,
    navigate: panelNavigator(router ?? platformRouter(), beside),
    messages: source.panel.content.messages ?? {},
    locale: global.locale,
    defaultLocale: String(global.fallbackLocale.value),
    translate: (key, params) => global.t(key, params ?? {}),
    currentUser: readPlatformCurrentUser,
    localDrafts: platformLocalDraftStore(),
  };
}

function readPlatformCurrentUser(): PanelCurrentUser | null {
  try {
    const name = authHost().getUserInfo()?.userName?.trim();
    return name ? { displayName: name } : null;
  } catch {
    return null;
  }
}

/** Where a panel's reads come from: its application use, or an author's candidate. */
type PanelReadSource = ProductPanelReadRequest["source"];

/** A panel's options in this document before the panels its state places inside it can be mounted. */
type OwnPanelOptions = Omit<DirectPanelMountOptions, "nested">;

/** A panel's options in this document, with which the panels its state places inside it are mounted too. */
function withNested(
  options: OwnPanelOptions,
  source: PanelReadSource,
  pageCounter?: PageCounter | null,
  panelChatHost?: PanelChatHost,
  feed?: PanelSessionFeed,
  nestedSnapshots?: Set<() => Promise<void>>,
): DirectPanelMountOptions {
  return { ...options, nested: (memberPath, run) => mountNested(options, source, memberPath, run, pageCounter, panelChatHost, feed, nestedSnapshots) };
}

/**
 * A panel placed inside another where the outer one's state puts it (standard: a panel in a panel is its own instance;
 * big main's ruling, 2026-11-21). Node resolves its definition along the full member path from the outer panel's
 * source, checking the placement, its candidates and the reader's use of it; its module runs on the outer panel's
 * options with its own declaration, words and run, at that member path, in an element of its own whose CSS reaches only
 * it. A panel whose CSS reaches outside it does not mount here: the block it was placed in says why.
 */
async function mountNested(
  outer: OwnPanelOptions, source: PanelReadSource, memberPath: ProductPanelNestedReadRequest["memberPath"], run: DirectPanelRun,
  pageCounter?: PageCounter | null,
  panelChatHost?: PanelChatHost,
  feed?: PanelSessionFeed,
  nestedSnapshots?: Set<() => Promise<void>>,
): Promise<{ element: HTMLElement; mount: PanelRunMount }> {
  const path: ProductPanelNestedReadRequest["memberPath"] = [...(outer.memberPath ?? []), ...memberPath] as ProductPanelNestedReadRequest["memberPath"];
  // A placement the reader may not use, or one whose record is gone or not among its candidates, is that block's own
  // state, said where the panel would be; any other failure is said as it is.
  const scope = currentDefinitionCacheScope();
  const answer = await json(`/api${PANEL_NESTED_READ_PATH}`, { method: "POST", body: JSON.stringify({ source, memberPath: path }) })
    .catch((failure: unknown) => {
      if (failure instanceof ApiRequestError && (failure.status === 403 || failure.status === 404))
        throw new PanelMemberUnavailable(failure.status, failure.message);
      throw failure;
    });
  const { panel, domainComponents, projections } = productPanelNestedReadResponseSchema.parse(answer);
  const mountBundle = ingestBundledPanelProjections(projections, scope);
  // An object's detail panel is Node's to name: the placement asked by the object alone, and the panel Node answered
  // with completes it, so the placed panel's own reads and operations name the panel they were admitted for.
  const placedAt: PanelMemberPath = [...path.slice(0, -1) as PanelMemberPath, resolvedSegment(path.at(-1)!, panel.id)];
  const instance = newPanelInstanceName();
  const { element, template, css } = codedPanelTarget(panel.content.html);
  element.dataset.panelInstance = instance;
  const dropStyle = css ? adoptPanelStyle(scopedPanelStyle(css, instance)) : undefined;
  // The placed panel's own theme with this placement's laid over it (default → … → the panel → this placement).
  const dropTheme = applyTheme(element, () => composeThemes(panel.theme, run.theme), hostThemeMode);
  const shown = () => outer.run.shown?.() ?? true;
  const nestedContainer = outer.run.overlayContainer ?? (outer.run.overlayRoot && outer.run.overlayRoot.parentElement && outer.run.overlayRoot.parentElement !== document.body
    ? () => outer.run.overlayRoot?.parentElement ?? null
    : undefined);
  const overlay = createPanelOverlayRoot(instance, shown, nestedContainer);
  try {
    const nestedReadProjection = source.kind === "candidate" || source.kind === "app-candidate"
      ? (id: string) => readPlatformProjection(id)
      : (id: string) => readCachedProjection(id, () => readPlatformProjection(id), { mountBundle, verifyAccess: true });
    const last = memberPath.at(-1);
    const mount = await withPersonalState(source, placedAt, panel.manifest, run, (opened) => mountCoded(
      withNested({
        ...outer,
        readProjection: nestedReadProjection,
        manifest: panel.manifest,
        messages: panel.content.messages ?? {},
        run: {
          ...opened,
          overlayRoot: overlay.element,
          windowOverlayRoot: overlay.windowElement,
          ...(nestedContainer ? { overlayContainer: nestedContainer } : {}),
          shown,
        },
        memberPath: placedAt,
        panelDomainComponents: domainComponents,
      }, source, pageCounter, panelChatHost, feed, nestedSnapshots),
      { element, template }, panel.content.module, pageCounter, panelChatHost, feed,
    ), new Set(Object.keys(last ? outer.manifest.members[last.member]?.inputs ?? {} : {})));
    const reconcile = async () => {
      const scope = currentDefinitionCacheScope();
      const verified = await snapshot(panel.id);
      if (!nestedSnapshots?.has(reconcile)) return;
      const unavailable = reconcileDefinitionCacheWithSnapshot(panel.id, panel, verified, scope);
      reconcileMountProjectionBundle(mountBundle, verified, unavailable);
      mount.projectionsChanged([...verified.projections, ...[...unavailable.keys()].map(id => ({ id }))]);
    };
    if (projections) nestedSnapshots?.add(reconcile);
    return {
      element,
      mount: {
        ...mount,
        dispose() {
          nestedSnapshots?.delete(reconcile);
          mount.dispose();
          overlay.dispose();
          dropStyle?.();
          dropTheme();
        },
      },
    };
  } catch (failure) {
    overlay.dispose();
    dropStyle?.();
    dropTheme();
    throw failure;
  }
}

/*
 * Personal state (product-layer standard, part two): a field a panel declares `personal: true` is kept for each reader,
 * by the use relation and the place the panel stands at, unless controlled by the entry's inputs or the enclosing
 * panel's member inputs (controlled fields are excluded from personal-state reads and writes at that slot). Opening,
 * the panel takes the reader's saved values under what the address or the entry gives it (those win), above its
 * declared defaults; as the reader changes them, they are saved, a moment after the last change and once more when the
 * panel goes — or the whole page does (a reload or a closed tab unmounts nothing), then as a request that outlives the
 * page. A panel that keeps none reads and writes nothing; a read that fails opens the panel at its defaults.
 */
const PERSONAL_STATE_DELAY = 400;

function personalFields(manifest: PanelManifest, controlled: ReadonlySet<string>) {
  return Object.entries(manifest.state)
    .filter(([name, field]) => field.personal && !controlled.has(name))
    .map(([name]) => name);
}

function personalFieldKey(fields: string[]) {
  return JSON.stringify([...fields].sort());
}

function readPersonalState(scope: { source: PanelReadSource; memberPath: PanelMemberPath }, fields: string[]) {
  return json(`/api${PANEL_PERSONAL_STATE_READ_PATH}`, { method: "POST", body: JSON.stringify({ ...scope, fields }) })
    .catch(() => ({ values: {} }));
}

type PersonalStateRead = { fieldKey: string; response: ReturnType<typeof readPersonalState> };

async function withPersonalState(
  source: PanelReadSource, memberPath: PanelMemberPath, manifest: PanelManifest, run: DirectPanelRun,
  mount: (run: DirectPanelRun) => Promise<PanelRunMount>,
  controlled: ReadonlySet<string>, pending?: PersonalStateRead,
): Promise<PanelRunMount> {
  const fields = personalFields(manifest, controlled);
  if (!fields.length || source.kind !== "registered") return mount(run);
  warmTemplateCompiler();
  const scope = { source, memberPath };
  const answer = await (pending && pending.fieldKey === personalFieldKey(fields) ? pending.response : readPersonalState(scope, fields));
  const saved = panelPersonalStateResponseSchema.parse(answer).values;
  const mounted = await mount({ ...run, initial: { ...saved, ...run.initial } as PanelHostState });
  const readField = (field: string) => mounted.instance.state.values.value[field] ?? null;
  const stored: Record<string, string> = Object.fromEntries(fields.map((field) => [field, JSON.stringify(readField(field))]));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = (keepalive = false) => {
    timer = undefined;
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = readField(field);
      const serialized = JSON.stringify(raw);
      if (serialized === stored[field]) continue;
      stored[field] = serialized;
      values[field] = raw;
    }
    if (!Object.keys(values).length) return;
    void json(`/api${PANEL_PERSONAL_STATE_PATH}`, {
      method: "PUT", body: JSON.stringify({ ...scope, values }), ...(keepalive && { keepalive: true }),
    }).catch(() => {});
  };
  /** Sends at once what is still waiting for the delay; `keepalive` lets the request finish after the page is gone. */
  const flush = (keepalive: boolean) => {
    if (timer === undefined) return;
    clearTimeout(timer);
    save(keepalive);
  };
  const leave = () => flush(true);
  window.addEventListener("pagehide", leave);
  const stop = Vue.watch(() => JSON.stringify(fields.map((field) => [field, readField(field)])), () => {
    clearTimeout(timer);
    timer = setTimeout(save, PERSONAL_STATE_DELAY);
  });
  return {
    ...mounted,
    dispose() {
      stop();
      window.removeEventListener("pagehide", leave);
      flush(false);
      mounted.dispose();
    },
  };
}

/** A placement's segment, completed with the panel Node answered when it was asked by the selected object alone. */
function resolvedSegment(segment: ProductPanelNestedReadRequest["memberPath"][number], panelId: string): PanelMemberPath[number] {
  const { selection } = segment;
  if (selection && "stateValue" in selection && !("target" in selection))
    return { ...segment, selection: { stateValue: selection.stateValue, target: { panelId } } };
  return segment as PanelMemberPath[number];
}

function warmTemplateCompiler() {
  // Coded mounts await the same promise and report any load failure.
  void useTemplateCompiler().catch(() => undefined);
}

function createPanelChatHost(
  defaultAgent?: ApplicationPanelUse["defaultAgent"],
  options?: Pick<PanelChatHost, "claimComposer" | "display">,
): PanelChatHost {
  let client: ReturnType<typeof createAssistantClient> | null = null;
  return {
    client: () => (client ??= createAssistantClient()),
    ...(defaultAgent ? { defaultAgent } : {}),
    claimComposer: options?.claimComposer,
    display: options?.display,
  };
}

/**
 * Runs a panel in this document: its module, once for this instance, with `vue` naming the platform's
 * Vue and `@ontomato/sdk/panel` an SDK of this instance's own, whose `mountPanel` mounts the panel's component into the
 * host's element on `options`' instance, with the platform's words and Element Plus's in the reader's language.
 */
async function mountCoded(
  options: DirectPanelMountOptions,
  target: CodedPanelTarget,
  module?: string,
  pageCounter?: PageCounter | null,
  panelChatHost?: PanelChatHost,
  feed?: PanelSessionFeed,
): Promise<PanelRunMount> {
  const { global } = workbenchI18n();
  const language = workbenchLanguage();
  await useTemplateCompiler();
  let mounted: PanelRunMount | undefined;
  const chatHost = { ...(panelChatHost ?? createPanelChatHost()), shown: options.run.shown };
  const panelSdk = panelModuleFor({
    ...options,
    loadDomainComponent,
    element: target.element,
    template: target.template,
    install(app) {
      app.use(workbenchI18n());
      provideGlobalConfig(Vue.computed(() => ({ locale: language.elementLocale(global.locale.value) })), app, true);
      app.provide(servePageComposerKey, servePageComposer);
      app.provide(panelChatHostKey, chatHost);
      if (feed?.stream) app.provide(pageSessionStream, feed.stream);
      if (feed) app.provide(sessionRunNotices, feed.notices);
      app.provide(panelPreviewHostKey, createPanelPreviewHost());
      if (pageCounter) app.provide(pageCounterKey, pageCounter);
    },
    mounted: mount => (mounted = mount),
  });
  if (!module || !module.trim()) {
    await panelSdk.mountPanel({});
  } else {
    const exported = await runPanelModule(module, {
      [panelModuleSpecifiers.vue]: Vue as unknown as Record<string, unknown>,
      [panelModuleSpecifiers.sdk]: panelSdk,
    });
    if (!mounted && exported.default && (typeof exported.default === "object" || typeof exported.default === "function")) {
      await panelSdk.mountPanel(exported.default as Parameters<typeof panelSdk.mountPanel>[0]);
    }
  }
  if (!mounted) throw new Error("The panel's module did not mount its component");
  return mounted;
}

/**
 * Single opening answer for one entry of an application: admits the reader, returns the entry use, frame panel ID,
 * theme, visible menu, standalone flag, and bundled frame/content panel definitions in one round trip.
 */
export async function resolveApplicationEntry(query: ApplicationEntryResolutionQuery): Promise<ApplicationOpenResponse> {
  const search = new URLSearchParams(applicationEntryResolutionQuerySchema.parse(query) as Record<string, string>);
  const answer = await json(`/api/product-panels/application-entry?${search}`);
  return applicationOpenResponseSchema.parse(answer);
}

/**
 * Returns the cached frame panel manifest synchronously if the frame host has already loaded it.
 */
export function cachedApplicationFrameManifest(
  applicationId: string,
  framePanelId: string,
): Pick<PanelManifest, "state"> | null {
  return getCachedPanel(framePanelCacheKey(applicationId, framePanelId))?.manifest ?? null;
}

class PanelStreamContractError extends Error {}

const targetKey = (target: ProductDefinitionTarget) => `${target.kind}:${target.id}`;
type AuthorObserver = {
  targets: Set<string>;
  onRevisions: Parameters<PanelAuthorDefinitions["observe"]>[1];
  onError: Parameters<PanelAuthorDefinitions["observe"]>[2];
};

let documentAuthors: PanelAuthorDefinitions | undefined;

/** The actual editor or preview opts in and passes this document's port to its panels. */
export function panelAuthorDefinitions(): PanelAuthorDefinitions {
  return documentAuthors ??= createAuthorDefinitions();
}

function createAuthorDefinitions(): PanelAuthorDefinitions {
  const observers = new Map<AuthorObserver, readonly ProductDefinitionTarget[]>();
  const observed = new Map<string, ProductDefinitionRevision>();
  let collection = "";
  let stop: (() => void) | undefined;

  function sync() {
    const targets = new Map<string, ProductDefinitionTarget>();
    for (const requested of observers.values())
      for (const target of requested) targets.set(targetKey(target), target);
    for (const key of observed.keys()) if (!targets.has(key)) observed.delete(key);
    const next = documentVisible() && targets.size ? JSON.stringify([...targets.keys()].sort()) : "";
    if (next === collection) return;
    stop?.();
    stop = undefined;
    collection = next;
    if (!next) return;
    stop = openDefinitionStream([...targets.values()], revisions => {
      const changed = revisions.filter(revision => {
        const key = targetKey(revision);
        if ((observed.get(key)?.revision ?? 0) >= revision.revision) return false;
        observed.set(key, revision);
        return true;
      });
      for (const revision of changed) {
        if (revision.kind === "panel") invalidateCachedPanelById(revision.id, revision.revision);
        else invalidateCachedProjection(revision.id, revision.revision);
      }
      for (const observer of observers.keys()) {
        const relevant = changed.filter(revision => observer.targets.has(targetKey(revision)));
        if (relevant.length) observer.onRevisions(relevant);
      }
    }, error => {
      for (const observer of observers.keys()) observer.onError(error);
    });
  }

  onDocumentVisibility(sync);
  return {
    observe(requested, onRevisions, onError) {
      const observer = { targets: new Set(requested.map(targetKey)), onRevisions, onError };
      function replace(targets: readonly ProductDefinitionTarget[]) {
        const previous = observers.has(observer) ? observer.targets : new Set<string>();
        observer.targets = new Set(targets.map(targetKey));
        observers.set(observer, targets);
        sync();
        const alreadyRead = [...observed.values()].filter(revision => {
          const key = targetKey(revision);
          return observer.targets.has(key) && !previous.has(key);
        });
        if (alreadyRead.length) onRevisions(alreadyRead);
      }
      replace(requested);
      return {
        replace,
        close() {
          observers.delete(observer);
          sync();
        },
      };
    },
  };
}

/** Reconnect the document's current author collection using the existing stream backoff. */
function openDefinitionStream(
  targets: readonly ProductDefinitionTarget[],
  onRevisions: AuthorObserver["onRevisions"],
  onError: AuthorObserver["onError"],
) {
  const stream = new AbortController();
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function connect() {
    try {
      const response = await nodeApiRequest(panelHostPaths.definitionStream, {
        method: "POST", signal: stream.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ targets }),
      });
      if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "text/event-stream")
        throw new PanelStreamContractError("Product definition stream did not return an event stream");

      await readSseData(response, payload => {
        if (stream.signal.aborted) return true;
        const parsed = productDefinitionStreamFrameSchema.safeParse(payload);
        if (!parsed.success) throw new PanelStreamContractError("Product definition stream frame broke the contract", { cause: parsed.error });
        const frame = parsed.data;
        if (frame.kind === "snapshot") attempt = 0;
        onRevisions(frame.kind === "snapshot" ? frame.definitions : [frame.definition]);
        return false;
      }, () => !stream.signal.aborted);
    } catch (reason) {
      if (stream.signal.aborted) return;
      const refused = reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404);
      if (refused || reason instanceof PanelStreamContractError || reason instanceof SyntaxError) {
        onError(reason);
        return;
      }
    }
    if (!stream.signal.aborted) timer = setTimeout(() => void connect(), sseReconnectDelay(attempt++));
  }

  void connect();
  return () => {
    stream.abort();
    clearTimeout(timer);
  };
}
