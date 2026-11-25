import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  displayLoadSchema,
  PANEL_LOAD_ERROR_CODES,
  type DisplayLoad,
  type FormFillOutcome,
  type FormFillRequestInput,
  type PageActionOutcome,
  type PageActionRequestInput,
} from "@ontomato/contracts/agent-presentation";
import type { PanelDefinitionSnapshot, ProductDefinitionRevision, ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { inject, onScopeDispose, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef } from "vue";
import { onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { ApplicationEntryMenu, CurrentApplicationEntry } from "@ontomato/contracts/product-panels";
import {
  PANEL_HOST_CHANNEL,
  panelAddress,
  panelAddressState,
  panelFrameMessageSchema,
  panelMessageOf,
  presentationAppliesAddress,
  restoredPanelAddressState,
  type PanelDefinitionMode,
  type PanelHostFrameMessage,
  type PanelHostSource,
  type PanelHostMessage,
  type PanelRefreshPort,
} from "@ontomato/contracts/panel-host";
import {
  matchesDirectPanelValue,
  normalizePanelDeepLinkState,
  panelStateValueSchema,
  type PanelObjectIdentity,
  type PanelOperation,
  type PanelThemeOverrides,
} from "@ontomato/contracts/panel-manifest";
import type { PanelCompletedOperation, PanelOperationAffected } from "@ontomato/contracts/panel-operations";
import { adoptPanelStyle, PanelStyleOutsideError, scopedPanelStyle, splitCodedPanelHtml } from "./panel-content";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import type { PanelDefinitionContent, ProductPanel } from "@ontomato/contracts/product-panels";
import type { PanelBackHandlerRegistration } from "./panel-back";

/** An instance's deep-linkable state as the host carries it: what the host message hands the frame. */
export type PanelHostState = PanelHostMessage["state"];
import { randomId } from "@ontomato/contracts/random-id";
import type { AppsSdkReleaseManifest } from "@ontomato/contracts/apps-sdk";

/*
 * A panel instance in the platform (overall design 3.4, "generic PanelHost"): the same component shows the panel full
 * screen, beside a conversation and inside another application, because all three only need a use relation, the current
 * record and somewhere to show it.
 *
 * Every panel is a Vue component — its `panel.html` template and its module — run in the platform's own document (user's
 * ruling, 2026-11-20: Vue is the only way a panel is written). Its instance has one lifecycle here: the address state,
 * page context, operations, refresh and definition changes it reports. The frame a panel once ran in is kept but
 * no longer one way a panel runs (user's ruling, 2026-11-20): it has no entry, and nothing below falls back to it.
 *
 * What the host does, and a panel's author therefore does not: read the use relation and the record, keep the declared
 * deep-linkable state in the address, hand the reader's page context to whoever writes the message, pass a changed
 * projection or panel definition to the frame, and never replace a form the reader has unsaved.
 */

/**
 * What the platform gives a panel host. The source is either a registered use relation with its current record — Java's
 * `GET /platform/applications/:applicationId/panel-uses` and Node's `GET /api/product-panels/:id`, both checking the
 * reader's use themselves — or an author's workspace candidate, which Node reads under the author's workspace access and
 * which has no panel ID, revision or use of its own.
 */
export interface PanelHostPort<Source extends HostedPanelSource = HostedPanelSource> {
  /** What this instance shows. A candidate is read again when the reader comes back to the page. */
  source(): Promise<Source>;
  /** The page key for this instance: the use relation's, or the one the candidate is previewed as. */
  readonly pageKey: string;
  /** The application use this instance shows, as the message names it to the frame; a candidate preview has none. */
  readonly use: PanelUseRef | null;
  /** A registered panel's current record, read again when its revision moves. */
  panel(panelId: string): Promise<ProductPanel>;
  /**
   * The SDK release the deployment serves now — its files' base and its manifest — which a panel written with code runs
   * on in its frame. There is one; a definition names none.
   */
  release(): Promise<PanelSdkRelease>;
  /**
   * Registers the frame the panel runs in: the execution context and identity for the page it shows, what the frame
   * may ask the platform for, which the source's manifest declares, and whether it may ask for anything now.
   */
  frame(frame: Window, source: Source, open: boolean): PanelFrameRegistration;
  /**
   * Starts a panel in the platform's own document: its module, run once for this instance, mounts its component into
   * `target.element` from `target.template`. Its instance reads what its members show through the platform as the reader;
   * the host keeps the instance's lifecycle. It settles once the module has mounted it, and fails with whatever stopped
   * the module.
   */
  coded(source: Source, run: DirectPanelRun, target: CodedPanelTarget): Promise<DirectPanelMount>;
  snapshot(panelId: string): Promise<PanelDefinitionSnapshot>;
  /**
   * Whether the latest `source()` call already verified access and reconciled revisions against a server snapshot
   * before returning, so initial `load()` does not issue a duplicate snapshot immediately after mounting.
   */
  sourceReconciled?(): boolean;
  /**
   * Whether the use relation this host opens is still the application's, bound to the same panel: what a kept page is
   * checked against when it is shown again. A candidate has no relation to check.
   */
  current?(): Promise<boolean>;
  mode: PanelDefinitionMode;
}

/** The deployment's current SDK release: where its files are served, and its manifest's modules and stylesheet. */
export interface PanelSdkRelease {
  /** Browser path of the release's root, the deployment prefix included. */
  base: string;
  manifest: AppsSdkReleaseManifest;
}

/** What a host shows: a registered use relation with its record, or an author's candidate. */
export type HostedPanelSource = PanelHostSource;

/** The projections a source places directly: its members whose target is a fixed projection. */
function projectionIdsOf(shown: HostedPanelSource): string[] {
  return Object.values(shown.panel.manifest.members).flatMap(member => ("projectionId" in member.target ? [member.target.projectionId] : []));
}

/** What the host hands a panel's instance: where it is, what its address asks for, and where it reports. */
export interface DirectPanelRun {
  overlayRoot?: HTMLElement;
  shown?: () => boolean;
  /** The page's registration key. */
  pageKey: string;
  /** The instance's address, with its state, as the reader and a message see it. */
  url: () => string;
  label: () => string;
  /** The initial state supplied by the address, the entry and live state. */
  initial: PanelHostState;
  /**
   * Its deep-linkable state, as it holds it at the address it was told last: the host carries it into the address, and
   * ignores a report for an address it has since replaced. The first report says the instance runs.
   */
  state(state: PanelHostState, fromAddress: string): void;
  context(context: PageContext): void;
  operations(operations: readonly PanelOperation[]): void;
  dirty(dirty: boolean): void;
  /** The panel cannot run, and why. */
  failed(reason: unknown): void;
  /**
   * The placement's theme, for a panel another panel places: the host lays it over the placed panel's own theme on the
   * placed panel's element, so this placement's values win over the panel's.
   */
  theme?: PanelThemeOverrides;
  /**
   * Only for an application's frame panel: the entry the platform resolved for this address, the menu the same answer
   * gave, and where the entry's content goes. Absent, the panel is not running as a frame.
   */
  currentEntry?: {
    /** The entry shown now; it changes when the reader opens another entry of the application, the frame staying. */
    readonly entry: Readonly<Ref<CurrentApplicationEntry>>;
    /** The resolution's menu (its groups and the reader's visible entries), the same answer that admitted the entry. */
    readonly menu: Readonly<Ref<ApplicationEntryMenu>>;
    /**
     * Optional host-supplied menu groups for hybrid built-in applications that still mix panel entries and native pages
     * inside one menu; absent for pure panel applications, which read `menu` directly.
     */
    readonly hostMenu?: Readonly<Ref<readonly import("./types").AppMenuGroup[] | null>>;
    /** Puts the content instance the host admitted and runs into `element`; never a new one. */
    place(element: HTMLElement): { dispose(): void };
  };
  /**
   * Current application frame state for content panels rendered inside a framed application (or beside a conversation
   * with a `frame` segment in the address).
   */
  frameState?: () => Readonly<Record<string, RuntimeJsonValue>> | undefined;
  /** Registers a panel-local back/close step (LIFO) with the host's history and Escape coordinator. */
  registerBackHandler?: (registration: PanelBackHandlerRegistration) => () => void;
  /** Unified host confirmation for leaving unsaved edits (danger confirm button, Cancel focused by default). */
  confirmLeaveUnsaved?: () => Promise<boolean>;
}

/** A started panel instance, as its host drives it. */
export interface DirectPanelMount {
  /** The address changed outside the instance (the reader went back, a link was followed): its state follows. */
  address(url: string): void;
  /** Reads the instance's live public state, including fields that are absent from the address. */
  publicState(): Readonly<Record<string, RuntimeJsonValue>>;
  blocksFormInputChange(fields: ReadonlySet<string>): boolean;
  applyStatePreservingDrafts(patch: Readonly<Record<string, RuntimeJsonValue>>): Promise<boolean>;
  /** Updates any declared public state fields in place (including non-deepLink fields), without reload or writes. */
  setState?(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  /** Objects it may show changed: it reads again what it shows of them. */
  refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected, operation?: PanelCompletedOperation): void;
  /** Projections it places have newer definitions or changed access: it reads them again. */
  projectionsChanged(projections: readonly { id: string; revision?: number }[]): void;
  /** Whether its reads may run: not while its page is out of the reader's view. */
  activate(active: boolean): void;
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  fillForm?(request: FormFillRequestInput): Promise<FormFillOutcome>;
  executeAction?(request: PageActionRequestInput): Promise<PageActionOutcome>;
  snapshotMeta?(): {
    readonly panelInstanceId?: string;
    readonly memberInstances?: Readonly<Record<string, string>>;
    readonly entryInstances?: Readonly<Record<string, string>>;
    readonly checkedKeys?: Readonly<Record<string, readonly string[]>>;
  };
  isLoading?(): boolean;
  dispose(): void;
}

/** A registered frame: ended with the instance, and closed to new requests while its page is not the reader's. */
export interface PanelFrameRegistration {
  dispose(): void;
  /** Whether the frame may ask for anything; closing it also closes its streams. */
  open(open: boolean): void;
}

export type { ProductDefinitionChangedEvent as DefinitionChanged } from "@ontomato/contracts/product-panels";

export const panelHostKey: InjectionKey<PanelHostPort> = Symbol("panel-host");

/** The platform's panel host, or nothing where panels cannot be opened. */
export function usePanelHostPort(): PanelHostPort | null {
  return inject(panelHostKey, null);
}

/** One running panel instance: its source, the frame it runs in and what it reports. */
export interface PanelInstanceView {
  /** What the instance shows, once read: the registered use and record, or the workspace candidate. */
  readonly source: Ref<HostedPanelSource | null>;
  /** What a message from this instance carries now; null until the panel's module reports. */
  readonly pageContext: Readonly<ShallowRef<PageContext | null>>;
  /** The message written into the frame's document; empty while the record is being read or when no frame runs it. */
  readonly document: Readonly<Ref<string>>;
  /** The running panel: the element its component is mounted in, and its instance; null until it runs. */
  readonly direct: Readonly<ShallowRef<DirectInstance | null>>;
  /** What names this instance's element, where its panel's CSS applies. */
  readonly instance: string;
  /** Live mount identity that rotates whenever the panel definition is replaced in place. */
  readonly mountId: Readonly<Ref<string>>;
  /** What the panel's author should know without the panel failing: its CSS reached outside it and applies nowhere. */
  readonly notice: Readonly<ShallowRef<string>>;
  /** The reader's deep-linkable state, as the address carries it. */
  readonly state: Ref<PanelHostState>;
  /** The instance's address, with its state; never a credential or a form value. */
  readonly address: Ref<string>;
  /** The operations the instance offers, as its frame reported them. */
  readonly operations: Readonly<Ref<readonly PanelOperation[]>>;
  readonly error: Ref<string>;
  readonly displayLoad: Readonly<ShallowRef<DisplayLoad>>;
  readonly dirty: Readonly<ShallowRef<boolean>>;
  /** Resolves once the source is read. */
  readonly ready: Promise<void>;
  /**
   * Objects the instance may show changed (U10): what it shows of the target is read again — everything it shows when
   * there is none — and a direct instance also matches the owner's affected objects and types against what it read.
   */
  refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected, operation?: PanelCompletedOperation): void;
  /** A person clicked one of those operations: the instance runs it, and the promise settles with its answer. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Validates a public state patch against the currently loaded panel manifest without mutating state. */
  validateState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  /** Applies a live patch to any declared public state fields in place (no reload, no business writes). */
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  /** Whether the proposed address and patch change a dirty form's bound inputs. */
  blocksNavigation(next: { address: string; state?: Readonly<Record<string, RuntimeJsonValue>> }): boolean;
  /** Tries a same-page state change with dirty forms. Undefined leaves the change to normal navigation. */
  probePresentation(next: Parameters<PanelInstanceView["blocksNavigation"]>[0]): Promise<boolean | undefined>;
  /** Applies deep-link overrides before the address reaches a panel with unsaved edits. */
  presentationAddress(address: string, patch: Readonly<Record<string, RuntimeJsonValue>>): string;
  /** Fills explicit fields on a mounted live form through the form's own editing entry. */
  fillForm(request: FormFillRequestInput): Promise<FormFillOutcome>;
  /** Executes a declared operation or local semantic action through the mounted component's own UI entry. */
  executeAction(request: PageActionRequestInput): Promise<PageActionOutcome>;
  /** Live binding metadata (mount/panel/member/entry instance IDs and checked row keys) for display snapshots. */
  snapshotMeta(): {
    readonly mountId: string;
    readonly panelInstanceId?: string;
    readonly memberInstances?: Readonly<Record<string, string>>;
    readonly entryInstances?: Readonly<Record<string, string>>;
    readonly checkedKeys?: Readonly<Record<string, readonly string[]>>;
  };
  /** True while the panel definition, direct mount, or declared members are still loading. */
  isLoading(): boolean;
  /** The frame's content window, once it exists. */
  frame(window: Window | null): void;
}

/**
 * What a panel host says to a reader, in the platform's language: the platform that mounts the host supplies the words,
 * as it does the shell's.
 */
export interface PanelHostLabels {
  /** An operation was asked of the panel before its frame started. */
  notStarted: string;
  /**
   * What the frame reports when the panel's own text fails before it can say so itself: a file it could not load (where
   * `{file}` stands for that file), and a script that failed while it ran or rejected with nothing to say.
   */
  failures: { fileUnavailable: string; scriptThrew: string; scriptRejected: string };
  /** What a panel tells its author: its CSS reached outside it. */
  content: { styleOutside: string };
  /** The page command that reads the panel's shown data again. */
  refresh: string;
}

/** A running panel: the element its own component is mounted in, which the host places in the page, and its instance. */
export interface DirectInstance {
  element: HTMLElement;
  mount: DirectPanelMount;
}

/** Where a panel mounts: the element the host made for it, and the template its `#app` holds. */
export interface CodedPanelTarget {
  element: HTMLElement;
  template: string;
}

/** Each instance's own name for its element, so its panel's CSS reaches it and no other. */
let instances = 0;
export function newPanelInstanceName(): string {
  return `panel-${++instances}`;
}

export function createPanelOverlayRoot(instance: string, shown: () => boolean) {
  const element = document.createElement("div");
  element.className = "panel-host-overlay-root";
  element.dataset.panelInstance = instance;
  element.dataset.panelOverlayRoot = "";
  const stop = watch(shown, (visible) => {
    element.hidden = !visible;
    element.style.display = visible ? "" : "none";
    element.inert = !visible;
  }, { immediate: true, flush: "sync" });
  document.body.append(element);
  return {
    element,
    dispose() {
      stop();
      element.remove();
    },
  };
}

/**
 * Where a panel's component mounts in this document: an element carrying its `#app`'s own attributes, the template
 * `#app` holds, and the panel's CSS, which its host scopes to the instance.
 */
export function codedPanelTarget(html: string): CodedPanelTarget & { css: string } {
  const { template, rootAttributes, css } = splitCodedPanelHtml(html);
  const element = globalThis.document.createElement("div");
  for (const [name, value] of Object.entries(rootAttributes)) element.setAttribute(name, value);
  // A bare `#app` mount wrapper (neither class nor inline style) is transparent to layout so the panel's own root
  // sits directly inside the definite-height content box.
  if (!("class" in rootAttributes) && !("style" in rootAttributes)) element.dataset.panelBareRoot = "";
  return { element, template, css };
}

export interface PanelInstanceOptions {
  /** The words the host shows the reader. */
  labels: PanelHostLabels;
  /** What a message calls the page: the registered panel's own name, and whatever the page adds to it, or the page's word for a candidate. */
  label: (source: HostedPanelSource) => string;
  /**
   * The page's address as the reader and a message see it — the use relation's full path, or the candidate preview's
   * address — without any state. The instance's declared deep-linkable state is added to it here, and that is the only thing the address
   * carries beyond the page itself: no credential and no form value ever goes into it.
   */
  address: () => string;
  /** The current external address's requested state, including updates on the same page. */
  initial: () => Record<string, unknown>;
  /** State values supplied by the application entry. */
  entryInputs?: () => Readonly<Record<string, RuntimeJsonValue>> | undefined;
  /** Optional initial live state patch (covering all declared public state, not only deepLink) for a newly opened panel. */
  liveState?: () => Readonly<Record<string, RuntimeJsonValue>> | null;
  /** Entry-wired state field names that cannot be overridden by live state patches. */
  wired?: () => readonly string[];
  /**
   * Whether the reader is on this instance's page. A page kept while the reader is on another of its application's pages
   * holds no stream and its frame may ask for nothing; shown again, it is checked before its frame may. Absent means
   * always shown.
   */
  shown?: () => boolean;
  /** A kept page shown again passed its checks: its frame may ask again, and its objects are being read again. */
  reopened?: () => void;
  /** A kept page shown again is no longer the application's: its use relation was withdrawn or bound elsewhere. */
  withdrawn?: () => void;
  /** For an application's frame panel: the entry shown in it, the menu and where the entry's page goes. */
  currentEntry?: DirectPanelRun["currentEntry"];
  /** Current application frame state for content panels inside a framed application entry. */
  frameState?: DirectPanelRun["frameState"];
  /** Registers a panel-local back/close step (LIFO) with the host's history and Escape coordinator. */
  registerBackHandler?: DirectPanelRun["registerBackHandler"];
  /** Unified host confirmation for leaving unsaved edits. */
  confirmLeaveUnsaved?: DirectPanelRun["confirmLeaveUnsaved"];
}

/** What a failure is called in the panel's error place: its own message, or what it was, verbatim. */
const failureText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

function httpStatusOf(failure: unknown) {
  if (failure instanceof Error && "status" in failure && typeof failure.status === "number") return failure.status;
}

/** What a display receipt says when the panel's page could not read what it shows: the failure, with its HTTP status. */
export function panelUnavailable(failure: unknown): DisplayLoad {
  const message = failureText(failure);
  const status = httpStatusOf(failure);
  return {
    status: "error",
    error: { code: PANEL_LOAD_ERROR_CODES.panelUnavailable, message: status === undefined ? message : `HTTP ${status}: ${message}` },
  };
}

// The bootstrap script can distinguish browser load failures before the SDK starts and sends its own reports.
const frameLoadFailureSchema = displayLoadSchema.pick({ error: true }).required();
const loading: DisplayLoad = { status: "loading" };

/**
 * Loads one panel instance from its source and keeps it current. The instance is this composable's alone: two
 * callers of the same panel hold two states, and neither sees the other's selection.
 */
export function usePanelInstance(port: PanelHostPort, options: PanelInstanceOptions): PanelInstanceView {
  const source = shallowRef<HostedPanelSource | null>(null);
  const direct = shallowRef<DirectInstance | null>(null);
  const instance = newPanelInstanceName();
  const mountId = shallowRef(randomId());
  const notice = shallowRef("");
  /** Takes the drawn panel's CSS away again. */
  let dropStyle: (() => void) | undefined;
  let dropOverlay: (() => void) | undefined;
  const pageContext = shallowRef<PageContext | null>(null);
  const document = shallowRef("");
  const error = shallowRef("");
  const displayLoad = shallowRef(loading);
  const dirty = shallowRef(false);
  const state = shallowRef<PanelHostState>({});
  const address = shallowRef("");
  const operations = shallowRef<readonly PanelOperation[]>([]);
  let frame: Window | null = null;
  /** Whether the instance runs: its frame reported its first state, or its direct instance started. */
  let frameReady = false;
  let frameAddress = "";
  let adoptedExternalAddress = "";
  let pendingDirectAddress: string | null = null;
  let pendingLiveState: Readonly<Record<string, RuntimeJsonValue>> | null = null;
  let appliedExternalEntry: PanelHostState = {};
  let registration: PanelFrameRegistration | undefined;
  /** Whether the frame may ask the platform for anything: not while its page is kept out of view, nor until it is checked. */
  let bridgeOpen = true;
  let active = true;
  let author: ReturnType<Extract<PanelDefinitionMode, { kind: "author" }>["definitions"]["observe"]> | undefined;
  const pending = new Map<string, ProductDefinitionRevision>();
  /** Fixed projections reported `forbidden` by the latest snapshot: forced re-read so revoked grants show immediately. */
  const pendingForbiddenProjections = new Set<string>();
  /** A candidate read again whose definition differs from the one shown; it waits like a changed record does. */
  let pendingCandidate: HostedPanelSource | null = null;
  let pendingObjectRefresh = false;
  const shownToReader = options.shown ?? (() => true);
  let applying = Promise.resolve();
  const answering = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let settle: () => void = () => {};
  const ready = new Promise<void>((resolve) => (settle = resolve));

  function reportPanelUnavailable(failure: unknown) {
    error.value = failureText(failure);
    if (displayLoad.value.status === "error") return;
    displayLoad.value = panelUnavailable(failure);
  }

  /**
   * Reads what this instance needs: its source and the SDK version its definition names. Whatever fails is reported
   * where the panel would have been — a page that cannot say why it is empty is worse than one that says what it could
   * not read.
   */
  async function load() {
    try {
      const read = await port.source();
      if (!active) return;
      await adopt(read);
      if (!active) return;
      if (port.mode.kind === "author") follow(read);
      // A viewer's panel is reconciled with a short read; the frame does not wait for it.
      else if (read.kind === "registered" && !port.sourceReconciled?.())
        void port.snapshot(read.panel.id).then(snapshot => { if (active) return reconcileSnapshot(snapshot); })
          .catch(failure => { if (active) reportPanelUnavailable(failure); });
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    } finally {
      settle();
    }
  }

  /** The current SDK release: read once, and only for a panel that runs in a frame. */
  let release: Promise<PanelSdkRelease> | undefined;

  /** Shows a source: its component, run in this document. */
  async function adopt(next: HostedPanelSource) {
    error.value = "";
    const requested = requestedState(next.panel) as PanelHostState;
    const requestedAddress = panelAddress(options.address(), requested, next.panel.manifest);
    // A panel runs in the platform's document (user's ruling, 2026-11-20): the frame below is kept but no
    // longer a way a panel runs.
    if (next.panel.content.module !== undefined) {
      await adoptCoded(next, requested, requestedAddress);
      return;
    }
    const current = await (release ??= port.release());
    if (!active) return;
    const { content, manifest } = next.panel;
    // Only the renderable definition crosses into the frame; the record's identity and a candidate's preview context stay
    // with the host.
    const message: PanelHostMessage = {
      kind: "panel-host-message",
      panel: { content, manifest },
      pageKey: port.pageKey,
      use: port.use,
      url: requestedAddress,
      // What a message calls the page: the panel's own registered name, which its author wrote, with the application's
      // when the page passes one.
      label: options.label(next),
      state: requested,
    };
    const written = panelFrameDocument(message.panel, current, message, options.labels.failures);
    source.value = next;
    // A new revision with the same definition is the document the frame already runs: it keeps its instance.
    if (written === document.value) return;
    endDirect();
    state.value = requested;
    address.value = requestedAddress;
    frameAddress = address.value;
    frameReady = false;
    displayLoad.value = loading;
    document.value = written;
    if (frame) {
      registration?.dispose();
      registration = port.frame(frame, next, bridgeOpen);
    }
  }

  function validatePublicStatePatch(
    panel: HostedPanelSource["panel"],
    patch: Readonly<Record<string, RuntimeJsonValue>>,
  ): Record<string, RuntimeJsonValue> {
    const wired = new Set(options.wired?.() ?? []);
    const validated: Record<string, RuntimeJsonValue> = {};
    for (const [name, value] of Object.entries(patch)) {
      if (wired.has(name)) {
        throw new Error(`Panel state '${name}' is fixed by the entry and cannot be changed`);
      }
      const field = panel.manifest.state[name];
      if (!field) throw new Error(`Panel state has no declared public field '${name}'`);
      const parsed = panelStateValueSchema.parse(value);
      if (!matchesDirectPanelValue(field.type, parsed)) {
        throw new TypeError(`Panel state '${name}' holds no ${JSON.stringify(field.type)} value`);
      }
      validated[name] = parsed as RuntimeJsonValue;
    }
    return validated;
  }

  /**
   * Starts a panel in this document: its HTML split into the template its `#app` holds, the element it mounts into
   * (carrying `#app`'s own attributes) and its CSS, scoped to this instance.
   * A source adopted while the module ran replaces it: the mount that comes back late is let go.
   */
  async function adoptCoded(next: HostedPanelSource, requested: PanelHostState, requestedAddress: string) {
    const initialLive = pendingLiveState ?? options.liveState?.() ?? null;
    pendingLiveState = null;
    const livePatch = initialLive ? validatePublicStatePatch(next.panel, initialLive) : null;
    const mergedInitial: PanelHostState = livePatch ? { ...requested, ...livePatch } : requested;
    const deepLinkInitial: PanelHostState = Object.fromEntries(
      Object.entries(mergedInitial).filter(([name]) => next.panel.manifest.state[name]?.deepLink),
    );
    const initialExternalEntry: PanelHostState = Object.fromEntries(
      Object.entries(requested).filter(([name]) => {
        const field = next.panel.manifest.state[name];
        return field?.external && !field.deepLink;
      }),
    );
    const effectiveAddress = livePatch ? panelAddress(options.address(), deepLinkInitial, next.panel.manifest) : requestedAddress;
    adoptedExternalAddress = requestedAddress;
    if (!replaceDirect(next, deepLinkInitial, effectiveAddress)) return;
    const { element, template, css } = codedPanelTarget(next.panel.content.html);
    adoptStyle(css);
    const overlay = createPanelOverlayRoot(instance, shownToReader);
    dropOverlay = overlay.dispose;
    let mount: DirectPanelMount;
    try {
      mount = await port.coded(next, directRun(next, mergedInitial, overlay.element), { element, template });
    } catch (failure) {
      overlay.dispose();
      if (!active || source.value !== next) return;
      throw failure;
    }
    if (!active || source.value !== next) {
      mount.dispose();
      return;
    }
    mount.activate(bridgeOpen);
    direct.value = { element, mount };
    appliedExternalEntry = initialExternalEntry;
    if (pendingDirectAddress !== null) {
      const nextAddress = pendingDirectAddress;
      pendingDirectAddress = null;
      mount.address(nextAddress);
    }
    if (pendingLiveState !== null) {
      const lateLive = pendingLiveState;
      pendingLiveState = null;
      const lateValidated = validatePublicStatePatch(next.panel, lateLive);
      mount.setState?.(lateValidated);
    }
    syncExternalEntryState();
  }

  /**
   * Takes a source to draw in this document: the same definition keeps the running instance, and anything else ends it
   * and starts over from the address the source asks for. Whether there is a new instance to start.
   */
  function replaceDirect(next: HostedPanelSource, requested: PanelHostState, requestedAddress: string) {
    const shown = source.value;
    source.value = next;
    if (direct.value && shown && JSON.stringify(definitionOf(shown)) === JSON.stringify(definitionOf(next))) return false;
    if (shown) mountId.value = randomId();
    endDirect();
    document.value = "";
    registration?.dispose();
    registration = undefined;
    state.value = requested;
    address.value = requestedAddress;
    frameAddress = requestedAddress;
    pendingDirectAddress = null;
    frameReady = false;
    displayLoad.value = loading;
    return true;
  }

  /** The panel's CSS, scoped to this instance; CSS that reaches outside it applies nowhere, and the author is told. */
  function adoptStyle(css: string | undefined) {
    if (!css) return;
    try {
      dropStyle = adoptPanelStyle(scopedPanelStyle(css, instance));
    } catch (failure) {
      if (!(failure instanceof PanelStyleOutsideError)) throw failure;
      notice.value = options.labels.content.styleOutside;
    }
  }

  let presentationProbe: { state?: [PanelHostState, string]; context?: PageContext } | undefined;

  /** What an instance in this document reports to its host, as a frame would in its messages. */
  function directRun(next: HostedPanelSource, requested: PanelHostState, overlayRoot: HTMLElement): DirectPanelRun {
    return {
      overlayRoot,
      shown: shownToReader,
      pageKey: port.pageKey,
      url: () => address.value,
      label: () => options.label(next),
      initial: requested,
      state(state, fromAddress) {
        if (presentationProbe) presentationProbe.state = [state, fromAddress];
        else stateReported(state, fromAddress);
      },
      context(context) {
        if (presentationProbe) presentationProbe.context = context;
        else pageContext.value = context;
      },
      operations: offered => (operations.value = offered),
      dirty: reportDirty,
      failed: reason => reportFrameFailure({ code: PANEL_LOAD_ERROR_CODES.scriptThrew, message: failureText(reason) }),
      ...(options.currentEntry ? { currentEntry: options.currentEntry } : {}),
      ...(options.frameState ? { frameState: options.frameState } : {}),
      ...(options.registerBackHandler ? { registerBackHandler: options.registerBackHandler } : {}),
      ...(options.confirmLeaveUnsaved ? { confirmLeaveUnsaved: options.confirmLeaveUnsaved } : {}),
    };
  }

  function endDirect() {
    direct.value?.mount.dispose();
    direct.value = null;
    dropOverlay?.();
    dropOverlay = undefined;
    appliedExternalEntry = {};
    dropStyle?.();
    dropStyle = undefined;
    notice.value = "";
  }

  /** What decides how a source is drawn: its content and declaration, not its revision or identity. */
  function definitionOf(shown: HostedPanelSource) {
    return { content: shown.panel.content, manifest: shown.panel.manifest };
  }

  /**
   * The instance reported its state at an address: a report for an address since replaced is stale. The first says the
   * instance runs — what waited for that (a definition change, a refresh, an address the page moved to) happens now.
   */
  function stateReported(next: PanelHostState, fromAddress: string) {
    if (fromAddress !== frameAddress) return;
    if (!frameReady) {
      frameReady = true;
      displayLoad.value = { status: "ready" };
      void applyPending();
      if (pendingObjectRefresh) {
        pendingObjectRefresh = false;
        refresh(null);
      }
      if (source.value && panelAddress(options.address(), requestedState(source.value.panel), source.value.panel.manifest) !== adoptedExternalAddress && syncAddress()) return;
    }
    const deepLinkOnly = source.value
      ? Object.fromEntries(Object.entries(next).filter(([name]) => source.value!.panel.manifest.state[name]?.deepLink))
      : next;
    reportState(deepLinkOnly);
  }

  /** The instance's deep-linkable state changed: the address carries it. */
  function reportState(next: PanelHostState) {
    state.value = next;
    address.value = panelAddress(options.address(), next, source.value?.panel.manifest);
  }

  /** The instance holds unsaved changes, or no longer does: a definition change waits for them. */
  function reportDirty(now: boolean) {
    dirty.value = now;
    if (!now && (pending.size || pendingForbiddenProjections.size || pendingCandidate)) void applyPending();
  }

  function snapshotRevisions(snapshot: PanelDefinitionSnapshot): ProductDefinitionRevision[] {
    return [
      { kind: "panel", ...snapshot.panel },
      ...snapshot.projections.map(projection => ({ kind: "projection" as const, ...projection })),
    ];
  }

  function reconcileSnapshot(snapshot: PanelDefinitionSnapshot) {
    const shown = source.value;
    if (shown && snapshot.members) {
      for (const member of snapshot.members) {
        if (member.status !== "forbidden" || member.memberPath.length !== 1) continue;
        const declaration = shown.panel.manifest.members[member.memberPath[0]!.member];
        if (declaration && "projectionId" in declaration.target) {
          pendingForbiddenProjections.add(declaration.target.projectionId);
        }
      }
    }
    return advance(snapshotRevisions(snapshot));
  }

  /** A registered panel and its projections; a candidate has no panel record, only the registered projections it names. */
  function targetsOf(shown: HostedPanelSource): ProductDefinitionTarget[] {
    return [
      ...(shown.kind === "registered" ? [{ kind: "panel" as const, id: shown.panel.id }] : []),
      ...projectionIdsOf(shown).map(id => ({ kind: "projection" as const, id })),
    ];
  }

  function advance(revisions: readonly ProductDefinitionRevision[]) {
    for (const revision of revisions) {
      const key = `${revision.kind}:${revision.id}`;
      if ((pending.get(key)?.revision ?? 0) < revision.revision) pending.set(key, revision);
    }
    return applyPending();
  }

  // Serialize definition adoption. While a form is dirty even a projection reload may replace its component.
  function applyPending() {
    applying = applying.then(async () => {
      const shown = source.value;
      if (!active || !frameReady || dirty.value || !shown) return;
      if (pendingCandidate) {
        const next = pendingCandidate;
        pendingCandidate = null;
        await adopt(next);
        author?.replace(targetsOf(next));
        return;
      }
      if (shown.kind === "registered") {
        const key = `panel:${shown.panel.id}`;
        if ((pending.get(key)?.revision ?? 0) > shown.panel.revision) {
          const record = await port.panel(shown.panel.id);
          if (!active || source.value !== shown || dirty.value) return;
          if (record.revision < pending.get(key)!.revision) return;
          pending.delete(key);
          const next = { ...shown, panel: record } as HostedPanelSource;
          await adopt(next);
          author?.replace(targetsOf(next));
          if (!active || !frameReady || dirty.value || source.value !== next) return;
        }
      }
      const current = source.value;
      if (!current) return;
      const projectionIds = new Set(projectionIdsOf(current));
      const directProjections = new Map<string, { id: string; revision?: number }>();
      for (const revision of pending.values()) {
        if (revision.kind === "projection" && projectionIds.has(revision.id)) {
          directProjections.set(revision.id, { id: revision.id, revision: revision.revision });
        }
      }
      for (const id of pendingForbiddenProjections) {
        if (projectionIds.has(id)) directProjections.set(id, { id });
      }
      pending.clear();
      pendingForbiddenProjections.clear();
      const projections = [...directProjections.values()];
      if (!projections.length) return;
      if (direct.value) direct.value.mount.projectionsChanged(projections);
      else {
        const frameProjections = projections.filter((p): p is { id: string; revision: number } => p.revision !== undefined);
        if (frameProjections.length) post({ kind: "projections-changed", projections: frameProjections });
      }
    }).catch(failure => { if (active) reportPanelUnavailable(failure); });
    return applying;
  }

  /** A viewer coming back reconciles the registered panel's revisions with a short read. */
  async function restore(shown: Extract<HostedPanelSource, { kind: "registered" }>) {
    try {
      const snapshot = await port.snapshot(shown.panel.id);
      if (active) await reconcileSnapshot(snapshot);
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    }
  }

  /**
   * An author coming back to a candidate preview reads the workspace again: its files may have changed meanwhile. A
   * changed definition waits for an unsaved form like a changed record does. The frame's execution context is fixed when
   * it is registered, so a test context started since takes reopening the preview.
   */
  async function rereadCandidate(shown: HostedPanelSource) {
    try {
      const next = await port.source();
      if (!active) return;
      if (JSON.stringify(next.panel) !== JSON.stringify(shown.panel)) {
        pendingCandidate = next;
        await applyPending();
      }
      if (active) refresh(null);
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    }
  }

  /** An author's instance follows its definitions on the document's stream while it is shown, and only then. */
  function follow(shown: HostedPanelSource) {
    if (shownToReader()) author = port.mode.kind === "author" ? port.mode.definitions.observe(targetsOf(shown), advance, reportPanelUnavailable) : undefined;
  }

  /**
   * The document came back to the foreground with this page shown: the objects it shows are read again, and a viewer's
   * definition revisions are checked beside that read; a changed definition is adopted as any is, never over an unsaved
   * form.
   */
  function resume(shown: HostedPanelSource) {
    if (shown.kind !== "registered") {
      void rereadCandidate(shown);
      return;
    }
    refresh(null);
    if (port.mode.kind === "view") void restore(shown);
  }

  /** Whether the instance may ask the platform for anything: its frame's bridge, or its direct instance's reads. */
  function openBridge(open: boolean) {
    bridgeOpen = open;
    registration?.open(open);
    direct.value?.mount.activate(open);
  }

  /**
   * A kept page shown again. Its frame is in view at once, but asks for nothing until the host has checked the page is
   * still the reader's — its use relation, and the current definitions the reader may use, read side by side. Then the
   * objects it shows are read again, whether or not anything changed, and a changed definition is adopted as any is. A
   * relation withdrawn or bound elsewhere ends the instance; a refused check is shown where the panel is.
   */
  async function reopen(shown: HostedPanelSource) {
    if (shown.kind !== "registered") {
      openBridge(true);
      follow(shown);
      void rereadCandidate(shown);
      return;
    }
    try {
      const [current, snapshot] = await Promise.all([
        port.current ? port.current() : true,
        port.mode.kind === "view" ? port.snapshot(shown.panel.id) : undefined,
      ]);
      if (!active || !shownToReader()) return;
      if (!current) {
        options.withdrawn?.();
        return;
      }
      // Recover a kept instance whose previous mount failed instead of leaving it permanently poisoned.
      if ((error.value !== "" || displayLoad.value.status === "error") && !direct.value && !document.value) {
        await adopt(shown);
        if (!active || !shownToReader()) return;
      }
      openBridge(true);
      options.reopened?.();
      follow(shown);
      refresh(null);
      if (snapshot) await reconcileSnapshot(snapshot);
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    }
  }

  watch(shownToReader, now => {
    const shown = source.value;
    if (!shown) return;
    if (now) {
      // Deliver any new external address immediately so the kept instance can enter loading state before reopen's
      // permission/snapshot check finishes instead of flashing the previously viewed record.
      syncAddress();
      void reopen(shown);
      return;
    }
    author?.close();
    author = undefined;
    openBridge(false);
  });
  const stopVisibility = onDocumentVisibility(visible => {
    const shown = source.value;
    if (visible && shown && shownToReader()) resume(shown);
  });
  void load();
  onScopeDispose(() => {
    active = false;
    stopVisibility();
    author?.close();
  });

  function post(message: PanelHostFrameMessage) {
    frame?.postMessage({ channel: PANEL_HOST_CHANNEL, ...message }, "*");
  }

  function refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected, operation?: PanelCompletedOperation) {
    const scopedOperation = source.value?.kind === "registered" && operation?.panelId === source.value.panel.id
      ? operation : undefined;
    if (!frameReady) pendingObjectRefresh = true;
    else if (direct.value) direct.value.mount.refresh(target, affected, scopedOperation);
    else post({
      kind: "object-changed",
      target,
      ...(scopedOperation ? { operation: scopedOperation, affected } : {}),
    });
  }

  function requestedState(panel: HostedPanelSource["panel"]) {
    const fromAddress = normalizePanelDeepLinkState(panel.manifest, options.initial());
    for (const name of options.wired?.() ?? []) delete fromAddress[name];
    return { ...fromAddress, ...entryState(panel) };
  }

  function entryState(panel: HostedPanelSource["panel"], externalOnly = false): PanelHostState {
    return Object.fromEntries(Object.entries(options.entryInputs?.() ?? {}).filter(([name, value]) => {
      const field = panel.manifest.state[name];
      return value !== undefined && field?.external && (!externalOnly || !field.deepLink);
    }));
  }

  function syncExternalEntryState() {
    if (!source.value || !direct.value) return;
    const panel = source.value.panel;
    const next = entryState(panel, true);
    const patch: Record<string, RuntimeJsonValue> = {};
    for (const [name, value] of Object.entries(next)) {
      if (!Object.hasOwn(appliedExternalEntry, name) || JSON.stringify(appliedExternalEntry[name]) !== JSON.stringify(value)) {
        patch[name] = value as RuntimeJsonValue;
      }
    }
    for (const name of Object.keys(appliedExternalEntry)) {
      if (!Object.hasOwn(next, name)) {
        const field = panel.manifest.state[name];
        if (field) patch[name] = (field.default ?? null) as RuntimeJsonValue;
      }
    }
    appliedExternalEntry = next;
    if (Object.keys(patch).length) direct.value.mount.setState?.(patch);
  }

  function syncAddress(): boolean {
    const shown = source.value;
    if (!shown) return false;
    const requested = panelAddress(options.address(), requestedState(shown.panel), shown.panel.manifest);
    if (error.value !== "" || displayLoad.value.status === "error") {
      if (requested === address.value) return false;
      if (!direct.value && !document.value) {
        void adopt(shown).catch(failure => {
          if (active) reportPanelUnavailable(failure);
        });
        return true;
      }
      error.value = "";
      displayLoad.value = { status: "ready" };
      frameReady = true;
      tellAddress(requested);
      return true;
    }
    if (!frameReady) return false;
    if (requested === address.value) return false;
    tellAddress(requested);
    return true;
  }
  // Compare `initial` by value like `entryInputs`: a parent re-render returning a fresh object with identical
  // contents (for example `panelAddressState(page.reported)` before `@display-address` propagates) must not
  // look like an external navigation back to the old address and overwrite state the panel just reported.
  watch(
    [options.address, () => JSON.stringify(options.initial()), () => JSON.stringify(options.entryInputs?.())],
    syncAddress,
  );
  watch(() => JSON.stringify(options.entryInputs?.()), syncExternalEntryState);

  /** The instance's address changed outside it: the frame hears it as a message, a direct instance as a call. */
  function tellAddress(next: string) {
    frameAddress = next;
    address.value = next;
    if (direct.value) direct.value.mount.address(next);
    else if (document.value) post({ kind: "address", address: next });
    else pendingDirectAddress = next;
  }

  function validateState(patch: Readonly<Record<string, RuntimeJsonValue>>) {
    if (!Object.keys(patch).length) return;
    if (source.value) {
      validatePublicStatePatch(source.value.panel, patch);
      return;
    }
    for (const [name, value] of Object.entries(patch)) {
      const parsed = panelStateValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new TypeError(`Invalid value for state '${name}': ${parsed.error.issues[0]?.message ?? "invalid type"}`);
      }
    }
  }

  function presentationPatch(
    next: Parameters<PanelInstanceView["blocksNavigation"]>[0],
    manifest: HostedPanelSource["panel"]["manifest"],
    current: Readonly<Record<string, RuntimeJsonValue>>,
  ) {
    const wired = new Set(options.wired?.() ?? []);
    const addressed = next.address !== address.value && presentationAppliesAddress(
      address.value, next.address, next.state !== undefined && Object.keys(next.state).length > 0,
    ) ? restoredPanelAddressState(next.address, manifest) : {};
    return Object.fromEntries(Object.entries({ ...addressed, ...next.state }).filter(([name, value]) =>
      Object.hasOwn(manifest.state, name) && !wired.has(name)
      && JSON.stringify(current[name]) !== JSON.stringify(value)));
  }

  function blocksNavigation(next: Parameters<PanelInstanceView["blocksNavigation"]>[0]): boolean {
    if (!dirty.value || !source.value || !direct.value) return false;
    const { mount } = direct.value;
    const patch = presentationPatch(next, source.value.panel.manifest, mount.publicState());
    return mount.blocksFormInputChange(new Set(Object.keys(patch)));
  }

  async function probePresentation(next: Parameters<PanelInstanceView["blocksNavigation"]>[0]): Promise<boolean | undefined> {
    if (!dirty.value || !source.value || !direct.value) return;
    const { mount } = direct.value;
    const patch = presentationPatch(next, source.value.panel.manifest, mount.publicState());
    if (!Object.keys(patch).length) return;
    // Publish only the settled context and keep the host address untouched until the change is accepted.
    const probe: NonNullable<typeof presentationProbe> = {};
    presentationProbe = probe;
    try {
      const kept = await mount.applyStatePreservingDrafts(patch);
      if (kept && probe.state) stateReported(...probe.state);
      if (probe.context) pageContext.value = probe.context;
      return kept;
    } finally {
      presentationProbe = undefined;
    }
  }

  function presentationAddress(next: string, patch: Readonly<Record<string, RuntimeJsonValue>>): string {
    if (!dirty.value || !source.value) return next;
    const { manifest } = source.value.panel;
    const overrides = Object.entries(patch).filter(([name]) => manifest.state[name]?.deepLink);
    if (overrides.length === 0) return next;
    const hashAt = next.indexOf("#");
    const path = hashAt === -1 ? next : next.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : next.slice(hashAt);
    return panelAddress(path, { ...panelAddressState(path, manifest), ...Object.fromEntries(overrides) }, manifest) + hash;
  }

  function applyState(patch: Readonly<Record<string, RuntimeJsonValue>>) {
    if (!Object.keys(patch).length) return;
    if (!source.value || !direct.value) {
      pendingLiveState = { ...(pendingLiveState ?? {}), ...patch };
      return;
    }
    const validated = validatePublicStatePatch(source.value.panel, patch);
    if (!direct.value.mount.setState) {
      throw new Error("This panel mount does not support live state updates");
    }
    direct.value.mount.setState(validated);
  }

  function reportFrameFailure(failure: NonNullable<DisplayLoad["error"]>) {
    error.value = failure.message;
    displayLoad.value = { status: "error", error: failure };
  }

  function message(event: MessageEvent) {
    if (event.source !== frame) return;
    const payload = panelMessageOf(panelFrameMessageSchema, event);
    if (!payload) {
      const failed = panelMessageOf(frameLoadFailureSchema, event);
      if (failed) reportFrameFailure(failed.error);
      return;
    }
    if (payload.kind === "context") pageContext.value = payload.context;
    if (payload.kind === "state") stateReported(payload.state, payload.fromAddress);
    if (payload.kind === "operations") operations.value = payload.operations;
    if (payload.kind === "dirty") reportDirty(payload.dirty);
    if (payload.kind === "failed") {
      // The frame could not run its panel. The reason goes where the panel would have been, and no frame is drawn over it.
      reportFrameFailure({ code: PANEL_LOAD_ERROR_CODES.scriptThrew, message: payload.message });
      return;
    }
    if (payload.kind === "invoked") {
      const waitingCall = answering.get(payload.requestId);
      answering.delete(payload.requestId);
      if (!waitingCall) return;
      if (payload.error === undefined) waitingCall.resolve(payload.result);
      else waitingCall.reject(new Error(payload.error));
    }
  }
  window.addEventListener("message", message);
  onScopeDispose(() => {
    window.removeEventListener("message", message);
    registration?.dispose();
    endDirect();
  });

  return {
    source,
    pageContext,
    document,
    state,
    address,
    operations,
    error,
    displayLoad,
    dirty,
    ready,
    refresh,
    direct,
    instance,
    mountId,
    notice,
    validateState,
    applyState,
    blocksNavigation,
    probePresentation,
    presentationAddress,
    fillForm(request) {
      if (!direct.value?.mount.fillForm) {
        return Promise.resolve({
          ok: false,
          reason: "form_not_ready",
          ...(request.member ? { member: request.member } : {}),
          ...(request.memberPath ? { memberPath: request.memberPath } : {}),
          message: "The panel is not mounted and ready for form filling.",
        });
      }
      return direct.value.mount.fillForm(request);
    },
    executeAction(request) {
      if (!direct.value?.mount.executeAction) {
        return Promise.resolve({
          ok: false,
          reason: "action_not_ready",
          operation: request.operation,
          message: "The panel is not mounted and ready for actions.",
        });
      }
      return direct.value.mount.executeAction(request);
    },
    snapshotMeta() {
      return {
        mountId: mountId.value,
        ...(direct.value?.mount.snapshotMeta?.() ?? {}),
      };
    },
    isLoading() {
      if (displayLoad.value.status === "error") return false;
      if (displayLoad.value.status === "loading" || !direct.value) return true;
      return direct.value.mount.isLoading?.() ?? false;
    },
    invoke(id, input) {
      if (direct.value) return direct.value.mount.invoke(id, input);
      if (!frame) return Promise.reject(new Error(options.labels.notStarted));
      const requestId = randomId();
      return new Promise((resolve, reject) => {
        answering.set(requestId, { resolve, reject });
        frame!.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "invoke", requestId, id, input }, "*");
      });
    },
    frame(window) {
      frame = window;
      registration?.dispose();
      registration = window && source.value ? port.frame(window, source.value, bridgeOpen) : undefined;
    },
  };
}

/** Escapes a text so it is data or code inside its own element and never ends the element it sits in. */
const escapeForElement = (text: string) => text.replaceAll("</", "<\\/");


/**
 * Runs before the panel's module, in a script of its own, and tells the host what the frame cannot otherwise say. A
 * module that cannot be fetched or parsed raises an `error` on its own element; a rejection nothing handled arrives as
 * `unhandledrejection`. Both are reported once — the first failure is the one worth reading. The words are the
 * platform's, in the reader's language; a script's own error message, when it has one, is reported as it is.
 */
const failureListener = (words: PanelHostLabels["failures"]) => `
(function () {
  var words = ${JSON.stringify(words)};
  var reported = false;
  function fail(code, what) {
    if (reported || !what) return;
    reported = true;
    window.parent.postMessage({ channel: "${PANEL_HOST_CHANNEL}", error: { code: code, message: String(what) } }, "*");
  }
  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && target.tagName) fail("${PANEL_LOAD_ERROR_CODES.fileUnavailable}", words.fileUnavailable.replace("{file}", target.src || target.href || target.tagName.toLowerCase()));
    else fail("${PANEL_LOAD_ERROR_CODES.scriptThrew}", (event.error && event.error.message) || event.message || words.scriptThrew);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    fail("${PANEL_LOAD_ERROR_CODES.scriptRejected}", (reason && reason.message) || reason || words.scriptRejected);
  });
})();`;

/**
 * The document one panel instance runs in: this SDK version's import map and stylesheet, the panel's HTML, its record as
 * the run's facts, and its module. The panel's text is content, so it is inserted as text.
 *
 * The panel's HTML is a fragment — what goes inside a body — because this document is the body it goes into: a panel
 * writes the markup it composes and its own styles, and the host writes the document around it.
 *
 * Before the module runs, a listener is installed that reports what would otherwise be silent: a module that cannot be
 * fetched, one that throws while it loads, and a rejection nothing handled. Without it a panel whose module failed leaves
 * the frame blank and the reader with no word about it.
 */
export function panelFrameDocument(
  record: PanelDefinitionContent,
  release: PanelSdkRelease,
  message: PanelHostMessage,
  failures: PanelHostLabels["failures"],
): string {
  // The deployment's one current release names its public modules and stylesheet: the frame imports exactly those.
  const imports = Object.fromEntries(
    Object.entries(release.manifest.entries).map(([specifier, file]) => [specifier, `${release.base}/${file}`]),
  );
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<link rel="stylesheet" href="${release.base}/${release.manifest.stylesheet}">`,
    '<script type="importmap">',
    escapeForElement(JSON.stringify({ imports })),
    "</script>",
    "<script>",
    escapeForElement(failureListener(failures)),
    // A panel's own style is isolated with it in its frame.
    ...(record.content.style === undefined ? [] : ["<style>", escapeForElement(record.content.style), "</style>"]),
    "</script></head><body>",
    record.content.html,
    '<script type="application/json" data-panel-host-message>',
    escapeForElement(JSON.stringify(message)),
    "</script>",
    ...(record.content.module === undefined ? [] : ['<script type="module">', escapeForElement(record.content.module), "</script>"]),
    "</body></html>",
  ].join("\n");
}
