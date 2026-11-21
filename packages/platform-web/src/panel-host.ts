import { ApiRequestError, nodeApiRequest } from "@ontomato/workbench-ui";
import {
  applicationEntryResolutionQuerySchema, applicationEntryResolutionSchema, productPanelResponseSchema, productPanelSchema,
  type ApplicationEntryResolution, type ApplicationEntryResolutionQuery, type ApplicationPanelUse,
  type ProductPanelReadQuery,
} from "@ontomato/contracts/product-panels";
import { appsSdkCurrentSchema, appsSdkReleaseManifestSchema } from "@ontomato/contracts/apps-sdk";
import {
  panelDefinitionSnapshotSchema, productDefinitionStreamFrameSchema,
  type ProductDefinitionRevision, type ProductDefinitionTarget,
} from "@ontomato/contracts/product-subscriptions";
import {
  candidatePanelSourceSchema, PANEL_NESTED_READ_PATH, PANEL_PERSONAL_STATE_PATH, PANEL_PERSONAL_STATE_READ_PATH,
  panelPersonalStateResponseSchema, productPanelNestedReadResponseSchema, productPanelReadResponseSchema,
  type ProductPanelNestedReadRequest,
  type CandidatePanelSource, type DirectPanelHostSource, type PanelHostSource, type PanelAuthorDefinitions, type PanelDefinitionMode,
  type ProductPanelReadRequest, type ProductPanelReadResponse,
} from "@ontomato/contracts/panel-host";
import { buildExecutionContext } from "@ontomato/contracts/build-tests";
import { pageSkillContextSchema, type PageSkillContext } from "@ontomato/contracts/page-skills";
import { panelModuleSpecifiers } from "@ontomato/contracts/panel-module";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import { readSseData, sseReconnectDelay } from "@ontomato/contracts/sse";
import { confirmPanelIntent, expandDeclaredComposer, hostThemeMode, platformRouter, registerCandidateFrame, registerPanelFrame } from "./app-host";
import { panelNavigator } from "./panel-navigate";
import {
  adoptPanelStyle, applyTheme, codedPanelTarget, composeThemes, newPanelInstanceName, scopedPanelStyle,
  type CodedPanelTarget, type DirectPanelMount, type DirectPanelRun, type PanelHostPort, type PanelHostState, type PanelSdkRelease,
} from "@ontomato/platform-shell";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import {
  panelModuleFor, PanelMemberUnavailable, type DirectPanelMount as PanelRunMount, type DirectPanelMountOptions, type PlatformRequests,
} from "@ontomato/apps-sdk/direct";
import { workbenchI18n, workbenchLanguage } from "@ontomato/workbench-ui/i18n";
import * as Vue from "vue";
import { provideGlobalConfig } from "element-plus";
import { runPanelModule, useTemplateCompiler } from "./panel-module";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import type { DisplayObjectChange } from "@ontomato/agent-shell-ui";

/*
 * The platform's panel host (overall design 3.4): the two reads a panel instance needs and the notices it listens to.
 *
 * - A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`); the application and its
 *   permissions stay there.
 * - A panel's current record is Node's (`GET /api/product-panels/:id`), read outside the frame under the reader's own
 *   credential; a projection's record is read inside the frame by the projection itself.
 * - An author's workspace candidate is Node's too (`GET /api/workspaces/:id/panel-candidate?ref=`), under the author's
 *   workspace access. It is the same host with another source: no use relation, panel ID or revision of its own, and a
 *   build-test execution context instead of a live one.
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

/** A panel's current record. */
async function panel(panelId: string) {
  return productPanelSchema.parse((await json(panelHostPaths.panel(panelId))).panel);
}

/** One named datum a panel's member shows, read by the platform as the reader, in one of its four states. */
export async function readPanelData(request: ProductPanelReadRequest): Promise<ProductPanelReadResponse> {
  return productPanelReadResponseSchema.parse(await json(panelHostPaths.read, { method: "POST", body: JSON.stringify(request) }));
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

/**
 * The platform's panel host for one use relation of the application whose page is showing it. `changed` is that page's:
 * a change its frame's operations report reaches the page through it.
 */
export function platformPanelHost(
  applicationId: string, use: ApplicationPanelUse, changed: (change: PanelObjectChange) => void, mode: PanelDefinitionMode = { kind: "view" },
  /** Java's answer for the application, when the page was opened from the shell's catalog before it came. */
  resolution?: Promise<ApplicationEntryResolution>,
  /** Hears which page skill a message written beside this page reaches, as Node answers it with the panel. */
  pageSkill?: (context: PageSkillContext) => void,
  /** Beside a conversation, the conversation's display, which opens an address the panel asks for; at full page, none. */
  beside?: (address: string) => void,
): PanelHostPort<Extract<PanelHostSource | DirectPanelHostSource, { kind: "registered" }>> {
  const shown: PanelUseRef = { applicationId, useId: use.id };
  /** Whether Java's answer for an entry is this page's use relation, still bound to the same panel. */
  const names = (answer: ApplicationEntryResolution) => answer.use.id === use.id && answer.use.panelId === use.panelId;
  // The page these reads are made for: the use relation it is shown for, and the entrance it is reached by — its menu
  // code, or domain membership, with its page key. Node answers with them which page skill member the reader reaches
  // here: null when it does not, never a public guess.
  const read: ProductPanelReadQuery = "permissionCode" in use.access
    ? { ...shown, pageKey: use.pageKey, permissionCode: use.access.permissionCode }
    : { ...shown, pageKey: use.pageKey, access: "domain-member" };
  const page = new URLSearchParams(read);
  return {
    // Opening reads the panel for this page.
    async source() {
      const answer = productPanelResponseSchema.parse(await json(`${panelHostPaths.panel(use.panelId)}?${page}`));
      // A read that names its page is answered with the page skill context; the host passes on what Node answered.
      pageSkill?.(pageSkillContextSchema.parse(answer.pageSkillContext));
      return { kind: "registered", applicationId, use, panel: answer.panel };
    },
    pageKey: use.pageKey,
    use: shown,
    panel,
    release,
    // The frame is this application's: the address the reader is on names it, and a panel shown beside a conversation is
    // the same application's page. Registering it under that ID is what lets the bridge recognise the frame and answer
    // its `connect`, and what keeps a frame of another application from being mistaken for this one. What it may ask for
    // is what the panel's record declares, for this use relation's page.
    frame: (frame, source, open) => registerPanelFrame(frame, shown, { pageKey: use.pageKey, manifest: source.panel.manifest }, open, changed),
    // The panel runs in this document, as the same application's page: its members read through the platform as the
    // reader, within this use, and a person's write is confirmed and dispatched here.
    coded: (source, run, target) => withPersonalState({ kind: "registered", ...shown }, [], source.panel.manifest, run,
      (opened) => mountCoded(withNested(directOptions(source, opened, shown, changed, beside), { kind: "registered", ...shown }), target, source.panel.content.module)),
    // The relation this page opens is still the application's, bound to the same panel: a kept page shown again is
    // checked against Java's current relations before its frame may ask for anything.
    async current() {
      return names(await resolveApplicationEntry(shown));
    },
    // Java's answer not coming is not admitting the page: the route that asked for it says why where the page would be.
    ...(resolution ? { admitted: resolution.then(names, () => false) } : {}),
    // The page's check of its definitions, when it is shown again or comes back to the foreground, is read for this page
    // too: the page skill it reaches is confirmed again with it, since what it may reach can have changed meanwhile.
    async snapshot(panelId) {
      const answer = panelDefinitionSnapshotSchema.parse(await json(`${panelHostPaths.snapshot(panelId)}?${page}`));
      pageSkill?.(pageSkillContextSchema.parse(answer.pageSkillContext));
      return answer;
    },
    mode,
  };
}

/**
 * The author's preview of a workspace candidate (design 6.2): the same host, reading the candidate instead of a use
 * relation. The preview is an author's host, so it declares author mode: the registered projections the candidate names
 * follow the document's definition stream. Its frame runs on the workspace's build-test context — NONE when the
 * workspace has none — and each owner decides what such a request may do.
 */
export function candidatePanelHost(candidate: CandidatePanelSource["workspace"] & { pageKey: string }): PanelHostPort<CandidatePanelSource> {
  return {
    async source() {
      return candidatePanelSourceSchema.parse(await json(panelHostPaths.candidate(candidate.id, candidate.ref)));
    },
    pageKey: candidate.pageKey,
    use: null,
    panel,
    release,
    frame: (frame, source, open) => registerCandidateFrame(frame, buildExecutionContext(source.workspace.id, source.previewContext.test), source.workspace, {
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
        use: null,
        read: request => readPanelData({ source: { kind: "candidate", workspace: source.workspace }, ...request }),
        confirmOperation: () => Promise.reject(new Error("A panel preview runs no operations; they run in the panel's application")),
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
 * The platform's requests as the reader, for a panel run in this document: the same paths a frame's SDK asks through
 * the bridge, sent here directly, Node's at `/api` and Java's under its data-query prefix.
 */
const platformRequests: PlatformRequests = {
  request: (path, init, service) => nodeApiRequest(`/api${service}${path}`, init),
};

/** What a panel of an application use runs on in this document: the SDK's instance with this platform's reads, requests and words. */
function directOptions(
  source: DirectPanelHostSource, run: DirectPanelRun, use: PanelUseRef, changed: (change: PanelObjectChange) => void, beside?: (address: string) => void,
): OwnPanelOptions {
  const { global } = workbenchI18n();
  return {
    manifest: source.panel.manifest,
    run,
    requests: platformRequests,
    use,
    read: request => readPanelData({ source: { kind: "registered", ...use }, ...request }),
    confirmOperation: preparation => confirmPanelIntent(use, preparation.intentId, changed),
    expandPageComposer: expandDeclaredComposer,
    navigate: panelNavigator(platformRouter(), beside),
    messages: source.panel.content.messages ?? {},
    locale: global.locale,
    defaultLocale: String(global.fallbackLocale.value),
    translate: (key, params) => global.t(key, params ?? {}),
  };
}

/** Where a panel's reads come from: its application use, or an author's candidate. */
type PanelReadSource = ProductPanelReadRequest["source"];

/** A panel's options in this document before the panels its state places inside it can be mounted. */
type OwnPanelOptions = Omit<DirectPanelMountOptions, "nested">;

/** A panel's options in this document, with which the panels its state places inside it are mounted too. */
function withNested(options: OwnPanelOptions, source: PanelReadSource): DirectPanelMountOptions {
  return { ...options, nested: (memberPath, run) => mountNested(options, source, memberPath, run) };
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
): Promise<{ element: HTMLElement; mount: PanelRunMount }> {
  const path: ProductPanelNestedReadRequest["memberPath"] = [...(outer.memberPath ?? []), ...memberPath] as ProductPanelNestedReadRequest["memberPath"];
  // A placement the reader may not use, or one whose record is gone or not among its candidates, is that block's own
  // state, said where the panel would be; any other failure is said as it is.
  const answer = await json(`/api${PANEL_NESTED_READ_PATH}`, { method: "POST", body: JSON.stringify({ source, memberPath: path }) })
    .catch((failure: unknown) => {
      if (failure instanceof ApiRequestError && (failure.status === 403 || failure.status === 404))
        throw new PanelMemberUnavailable(failure.status, failure.message);
      throw failure;
    });
  const { panel } = productPanelNestedReadResponseSchema.parse(answer);
  // An object's detail panel is Node's to name: the placement asked by the object alone, and the panel Node answered
  // with completes it, so the placed panel's own reads and operations name the panel they were admitted for.
  const placedAt: PanelMemberPath = [...path.slice(0, -1) as PanelMemberPath, resolvedSegment(path.at(-1)!, panel.id)];
  const instance = newPanelInstanceName();
  const { element, template, css } = codedPanelTarget(panel.content.html);
  element.dataset.panelInstance = instance;
  const dropStyle = css ? adoptPanelStyle(scopedPanelStyle(css, instance)) : undefined;
  // The placed panel's own theme with this placement's laid over it (default → … → the panel → this placement).
  const dropTheme = applyTheme(element, () => composeThemes(panel.theme, run.theme), hostThemeMode);
  try {
    const mount = await withPersonalState(source, placedAt, panel.manifest, run, (opened) => mountCoded(
      withNested({ ...outer, manifest: panel.manifest, messages: panel.content.messages ?? {}, run: opened, memberPath: placedAt }, source),
      { element, template }, panel.content.module,
    ));
    return { element, mount: { ...mount, dispose() { mount.dispose(); dropStyle?.(); dropTheme(); } } };
  } catch (failure) {
    dropStyle?.();
    dropTheme();
    throw failure;
  }
}

/*
 * Personal state (product-layer standard, part two): a field a panel declares \`personal: true\` is kept for each reader,
 * by the use relation and the place the panel stands at. Opening, the panel takes the reader's saved values under what
 * the address or the entry gives it (those win), above its declared defaults; as the reader changes them, they are
 * saved, a moment after the last change and once more when the page goes. A panel that keeps none reads and writes
 * nothing; a read that fails opens the panel at its defaults.
 */
const PERSONAL_STATE_DELAY = 400;

function personalFields(manifest: PanelManifest) {
  return Object.entries(manifest.state).filter(([, field]) => field.personal).map(([name]) => name);
}

async function withPersonalState(
  source: PanelReadSource, memberPath: PanelMemberPath, manifest: PanelManifest, run: DirectPanelRun,
  mount: (run: DirectPanelRun) => Promise<PanelRunMount>,
): Promise<PanelRunMount> {
  const fields = personalFields(manifest);
  if (!fields.length || source.kind !== "registered") return mount(run);
  const scope = { source, memberPath };
  const saved = await json(`/api${PANEL_PERSONAL_STATE_READ_PATH}`, { method: "POST", body: JSON.stringify({ ...scope, fields }) })
    .then((answer) => panelPersonalStateResponseSchema.parse(answer).values, () => ({}));
  const mounted = await mount({ ...run, initial: { ...saved, ...run.initial } as PanelHostState });
  const current = () => JSON.stringify(Object.fromEntries(fields.map((field) => [field, mounted.instance.state.values.value[field] ?? null])));
  let stored = current();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const next = current();
    if (next === stored) return;
    stored = next;
    void json(`/api${PANEL_PERSONAL_STATE_PATH}`, { method: "PUT", body: JSON.stringify({ ...scope, values: JSON.parse(next) }) }).catch(() => {});
  };
  const stop = Vue.watch(current, () => {
    clearTimeout(timer);
    timer = setTimeout(save, PERSONAL_STATE_DELAY);
  });
  return {
    ...mounted,
    dispose() {
      stop();
      if (timer !== undefined) {
        clearTimeout(timer);
        save();
      }
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

/**
 * Runs a panel in this document: its module, once for this instance, with `vue` naming the platform's
 * Vue and `@ontomato/sdk/panel` an SDK of this instance's own, whose `mountPanel` mounts the panel's component into the
 * host's element on `options`' instance, with the platform's words and Element Plus's in the reader's language.
 */
async function mountCoded(options: DirectPanelMountOptions, target: CodedPanelTarget, module: string): Promise<PanelRunMount> {
  const { global } = workbenchI18n();
  const language = workbenchLanguage();
  await useTemplateCompiler();
  let mounted: PanelRunMount | undefined;
  await runPanelModule(module, {
    [panelModuleSpecifiers.vue]: Vue as unknown as Record<string, unknown>,
    [panelModuleSpecifiers.sdk]: panelModuleFor({
      ...options,
      element: target.element,
      template: target.template,
      install(app) {
        app.use(workbenchI18n());
        provideGlobalConfig(Vue.computed(() => ({ locale: language.elementLocale(global.locale.value) })), app, true);
      },
      mounted: mount => (mounted = mount),
    }),
  });
  if (!mounted) throw new Error("The panel's module did not mount its component");
  return mounted;
}

/**
 * Java's answer for one entry of an application: by the address the reader opened, or by the application and use
 * relation a kept page was opened for. It admits the reader (the application's entry access and the use relation's), and
 * gives the use, the application's frame panel and theme where its renderer is \`panels\`, and the menu of the entries the
 * reader may see — one answer, so the page, its frame and its menu never come from two readings of the catalogue.
 */
export async function resolveApplicationEntry(query: ApplicationEntryResolutionQuery): Promise<ApplicationEntryResolution> {
  const search = new URLSearchParams(applicationEntryResolutionQuerySchema.parse(query) as Record<string, string>);
  const answer = await json(`/api/data-query/platform/applications/resolve-entry?${search}`);
  if (answer.success === false) throw new Error(answer.message ?? "This entry cannot be opened");
  return applicationEntryResolutionSchema.parse(answer.data ?? answer);
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
