import { displayLoadSchema, PANEL_LOAD_ERROR_CODES, type DisplayLoad } from "@ontomato/contracts/agent-presentation";
import type { PanelDefinitionSnapshot, ProductDefinitionRevision, ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { inject, onScopeDispose, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef, type VNodeChild } from "vue";
import { onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import type { PageContext } from "@ontomato/contracts/page-context";
import { PAGE_DRAFT_QUERY_KEYS, pageDraftLink, type PageDraftLink } from "@ontomato/contracts/page-draft";
import {
  PANEL_HOST_CHANNEL,
  panelAddress,
  panelAddressState,
  panelFrameMessageSchema,
  panelMessageOf,
  type PanelDefinitionMode,
  type PanelHostFrameMessage,
  type PanelHostSource,
  type PanelHostMessage,
  type PanelRefreshPort,
} from "@ontomato/contracts/panel-host";
import type { PanelObjectIdentity, PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationAffected } from "@ontomato/contracts/panel-operations";
import { parsePanelLayout, type PanelLayoutNode } from "@ontomato/contracts/panel-layout";
import { adoptPanelStyle, cleanPanelHtml, PanelStyleOutsideError, scopedPanelStyle, splitCodedPanelHtml } from "./panel-content";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { panelNeedsFrame, type PanelDefinitionContent, type ProductPanel } from "@ontomato/contracts/product-panels";

/** An instance's deep-linkable state as the host carries it: what the host message hands the frame. */
export type PanelHostState = PanelHostMessage["state"];
import { randomId } from "@ontomato/contracts/random-id";
import type { AppsSdkReleaseManifest } from "@ontomato/contracts/apps-sdk";

/*
 * A panel instance in the platform (overall design 3.4, "generic PanelHost"): the same component shows the panel full
 * screen, beside a conversation and inside another application, because all three only need a use relation, the current
 * record and somewhere to show it.
 *
 * Where it runs is the record's (direct rendering design 5): a panel with no code of its own — a layout and a declaration
 * — is drawn by the platform in its own document; a panel with a module runs that module in a frame of its own, with this
 * SDK version's modules. Both are one instance with one lifecycle here: the same address state, page context, draft,
 * operations, refresh and definition changes, reported from the frame's messages or from the direct instance alike.
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
  /** The page key a draft for this page names: the use relation's, or the one the candidate is previewed as. */
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
   * Starts a panel without code in the platform's own document: its instance, which reads what its members show through
   * the platform as the reader, and draws each member the layout places. The host keeps the instance's lifecycle.
   */
  direct(source: Source, run: DirectPanelRun): DirectPanelMount;
  /**
   * Starts a panel written with code in the platform's own document: its module, run once for this instance, mounts its
   * component into `target.element` from `target.template`, on the same instance a panel without code runs on. It
   * settles once the module has mounted it, and fails with whatever stopped the module.
   */
  coded(source: Source, run: DirectPanelRun, target: CodedPanelTarget): Promise<DirectPanelMount>;
  snapshot(panelId: string): Promise<PanelDefinitionSnapshot>;
  /**
   * Whether the use relation this host opens is still the application's, bound to the same panel: what a kept page is
   * checked against when it is shown again. A candidate has no relation to check.
   */
  current?(): Promise<boolean>;
  /**
   * The check a page opened ahead of Java's answer waits for: whether that answer names its use relation, bound to the
   * same panel. The page reads meanwhile and is shown only once it has passed. Absent when the relation was already
   * Java's answer.
   */
  admitted?: Promise<boolean>;
  mode: PanelDefinitionMode;
}

/** The deployment's current SDK release: where its files are served, and its manifest's modules and stylesheet. */
export interface PanelSdkRelease {
  /** Browser path of the release's root, the deployment prefix included. */
  base: string;
  manifest: AppsSdkReleaseManifest;
}

/** What a host shows: a panel written with code, or a direct panel the platform draws. */
export type HostedPanelSource = PanelHostSource;

/** The projections a source places directly: its members whose target is a fixed projection. */
function projectionIdsOf(shown: HostedPanelSource): string[] {
  return Object.values(shown.panel.manifest.members).flatMap(member => ("projectionId" in member.target ? [member.target.projectionId] : []));
}

/** Whether the platform draws this source itself: its content has no code or style of its own to isolate in a frame. */
export function runsDirect(source: HostedPanelSource): boolean {
  return !panelNeedsFrame(source.panel.content);
}

/** What the host hands a direct instance: where it is, what its address asks for, and where it reports. */
export interface DirectPanelRun {
  /** The page's registration key, which a draft names. */
  pageKey: string;
  /** The instance's address, with its state, as the reader and a message see it. */
  url: () => string;
  label: () => string;
  /** The declared deep-linkable state the address asks for. */
  initial: PanelHostState;
  /**
   * Its deep-linkable state, as it holds it at the address it was told last: the host carries it into the address, and
   * ignores a report for an address it has since replaced. The first report says the instance runs.
   */
  state(state: PanelHostState, fromAddress: string): void;
  context(context: PageContext): void;
  operations(operations: readonly PanelOperation[]): void;
  dirty(dirty: boolean): void;
  /** The reader saved or discarded the draft the address links. */
  draftSettled(draft: PageDraftLink): void;
  /** The panel cannot run (a draft no form takes, a draft that could not be read), and why. */
  failed(reason: unknown): void;
}

/** A started direct instance. */
export interface DirectPanelMount {
  /** Draws a member the layout places. */
  member(ref: string): VNodeChild;
  /** The instance's state, as its layout's conditions read it. */
  readonly values: Readonly<Ref<Readonly<Record<string, unknown>>>>;
  /** The address changed outside the instance (the reader went back, a link was followed): its state follows. */
  address(url: string): void;
  /** Objects it may show changed: it reads again what it shows of them. */
  refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected): void;
  /** Projections it places have newer definitions: it reads them again. */
  projectionsChanged(projections: readonly { id: string; revision: number }[]): void;
  /** Whether its reads may run: not while its page is out of the reader's view. */
  activate(active: boolean): void;
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
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
  /** A panel the platform draws: its layout and its started instance; null when a frame runs the panel. */
  readonly direct: Readonly<ShallowRef<DirectInstance | null>>;
  /** What names this instance's element, where its panel's CSS applies. */
  readonly instance: string;
  /**
   * What the author of a panel the platform draws should know without the panel failing: part of its HTML was removed
   * as it was drawn, or its CSS reached outside it and applies nowhere.
   */
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
  /** Whether the page may be shown: Java's answer names its use relation (always, when it opened from that answer). */
  readonly admitted: Readonly<ShallowRef<boolean>>;
  /**
   * Objects the instance may show changed (U10): what it shows of the target is read again — everything it shows when
   * there is none — and a direct instance also matches the owner's affected objects and types against what it read.
   */
  refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected): void;
  /** A person clicked one of those operations: the instance runs it, and the promise settles with its answer. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
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
  /** What a panel the platform draws tells its author: its HTML had content removed, its CSS reached outside it. */
  content: { htmlRemoved: string; styleOutside: string };
}

/** A panel the platform draws: its parsed layout and its running instance. */
export type DirectInstance =
  | { layout: PanelLayoutNode[]; mount: DirectPanelMount }
  /** A panel written with code: the element its own component is mounted in, which the host places in the page. */
  | { element: HTMLElement; mount: DirectPanelMount };

/** Where a panel written with code mounts: the element the host made for it, and the template its `#app` holds. */
export interface CodedPanelTarget {
  element: HTMLElement;
  template: string;
}

/** Each instance's own name for its element, so its panel's CSS reaches it and no other. */
let instances = 0;

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
  const admitted = shallowRef(!port.admitted);
  const direct = shallowRef<DirectInstance | null>(null);
  const instance = `panel-${++instances}`;
  const notice = shallowRef("");
  /** Takes the drawn panel's CSS away again. */
  let dropStyle: (() => void) | undefined;
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
  let registration: PanelFrameRegistration | undefined;
  /** Whether the frame may ask the platform for anything: not while its page is kept out of view, nor until it is checked. */
  let bridgeOpen = true;
  let active = true;
  let author: ReturnType<Extract<PanelDefinitionMode, { kind: "author" }>["definitions"]["observe"]> | undefined;
  const pending = new Map<string, ProductDefinitionRevision>();
  /** A candidate read again whose definition differs from the one shown; it waits like a changed record does. */
  let pendingCandidate: HostedPanelSource | null = null;
  let pendingObjectRefresh = false;
  /** The draft the reader settled while the page's address still linked it. */
  let settledDraft: PageDraftLink | null = null;
  const shownToReader = options.shown ?? (() => true);
  /** The page's address, without the link of a draft the reader has settled. */
  const pageAddress = () => {
    const page = options.address();
    return settledDraft && linksDraft(page, settledDraft) ? withoutDraftLink(page) : page;
  };
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
      // The page reads what it shows while Java's answer is still coming; it is shown once that answer names it.
      const read = await port.source();
      if (!active) return;
      await adopt(read);
      if (!active) return;
      if (!(await (port.admitted ?? true))) {
        if (active) options.withdrawn?.();
        return;
      }
      if (!active) return;
      admitted.value = true;
      if (port.mode.kind === "author") follow(read);
      // A viewer's panel is reconciled with a short read; the frame does not wait for it.
      else if (read.kind === "registered")
        void port.snapshot(read.panel.id).then(snapshot => { if (active) return advance([{ kind: "panel", ...snapshot.panel }]); })
          .catch(failure => { if (active) reportPanelUnavailable(failure); });
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    } finally {
      settle();
    }
  }

  /** The current SDK release: read once, and only for a panel that runs in a frame. */
  let release: Promise<PanelSdkRelease> | undefined;

  /** Shows a source: drawn by the platform when it has no code, in a frame when it has. */
  async function adopt(next: HostedPanelSource) {
    error.value = "";
    const requested = requestedState(next.panel) as PanelHostState;
    const requestedAddress = panelAddress(pageAddress(), requested);
    // A panel written with code runs in the platform's document too (user's ruling, 2026-11-20): the frame below is no
    // longer a way a panel runs.
    if (next.panel.content.module !== undefined) {
      await adoptCoded(next, requested, requestedAddress);
      return;
    }
    if (runsDirect(next)) {
      adoptDirect(next, requested, requestedAddress);
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

  /**
   * Starts a panel the platform draws: its layout, parsed against its declaration, and its instance, which reports here
   * what a frame would report in its messages. A new revision with the same definition keeps the running instance.
   */
  function adoptDirect(next: HostedPanelSource, requested: PanelHostState, requestedAddress: string) {
    if (!replaceDirect(next, requested, requestedAddress)) return;
    const cleaned = cleanPanelHtml(next.panel.content.html);
    const { nodes: layout, css } = parsePanelLayout(cleaned.html, next.panel.manifest);
    notice.value = cleaned.removed ? options.labels.content.htmlRemoved : "";
    adoptStyle(css);
    const mount = port.direct(next, directRun(next, requested));
    mount.activate(bridgeOpen);
    direct.value = { layout, mount };
  }

  /**
   * Starts a panel written with code in this document: its HTML split into the template its `#app` holds, the element it
   * mounts into (carrying `#app`'s own attributes) and its CSS, scoped to this instance as a panel without code's is.
   * A source adopted while the module ran replaces it: the mount that comes back late is let go.
   */
  async function adoptCoded(next: HostedPanelSource, requested: PanelHostState, requestedAddress: string) {
    if (!replaceDirect(next, requested, requestedAddress)) return;
    const { template, rootAttributes, css } = splitCodedPanelHtml(next.panel.content.html);
    const element = globalThis.document.createElement("div");
    for (const [name, value] of Object.entries(rootAttributes)) element.setAttribute(name, value);
    adoptStyle(css);
    const mount = await port.coded(next, directRun(next, requested), { element, template });
    if (!active || source.value !== next) {
      mount.dispose();
      return;
    }
    mount.activate(bridgeOpen);
    direct.value = { element, mount };
  }

  /**
   * Takes a source to draw in this document: the same definition keeps the running instance, and anything else ends it
   * and starts over from the address the source asks for. Whether there is a new instance to start.
   */
  function replaceDirect(next: HostedPanelSource, requested: PanelHostState, requestedAddress: string) {
    const shown = source.value;
    source.value = next;
    if (direct.value && shown && JSON.stringify(definitionOf(shown)) === JSON.stringify(definitionOf(next))) return false;
    endDirect();
    document.value = "";
    registration?.dispose();
    registration = undefined;
    state.value = requested;
    address.value = requestedAddress;
    frameAddress = requestedAddress;
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

  /** What an instance in this document reports to its host, as a frame would in its messages. */
  function directRun(next: HostedPanelSource, requested: PanelHostState): DirectPanelRun {
    return {
      pageKey: port.pageKey,
      url: () => address.value,
      label: () => options.label(next),
      initial: requested,
      state: stateReported,
      context: context => (pageContext.value = context),
      operations: offered => (operations.value = offered),
      dirty: reportDirty,
      draftSettled: settleDraft,
      failed: reason => reportFrameFailure({ code: PANEL_LOAD_ERROR_CODES.scriptThrew, message: failureText(reason) }),
    };
  }

  function endDirect() {
    direct.value?.mount.dispose();
    direct.value = null;
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
      if (syncAddress()) return;
    }
    reportState(next);
  }

  /** The instance's deep-linkable state changed: the address carries it. */
  function reportState(next: PanelHostState) {
    state.value = next;
    address.value = panelAddress(pageAddress(), next);
  }

  /** The instance holds unsaved changes, or no longer does: a definition change waits for them. */
  function reportDirty(now: boolean) {
    dirty.value = now;
    if (!now && (pending.size || pendingCandidate)) void applyPending();
  }

  function snapshotRevisions(snapshot: PanelDefinitionSnapshot): ProductDefinitionRevision[] {
    return [
      { kind: "panel", ...snapshot.panel },
      ...snapshot.projections.map(projection => ({ kind: "projection" as const, ...projection })),
    ];
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
          return;
        }
      }
      const projectionIds = new Set(projectionIdsOf(shown));
      const projections = [...pending.values()]
        .filter(revision => revision.kind === "projection" && projectionIds.has(revision.id))
        .map(({ id, revision }) => ({ id, revision }));
      pending.clear();
      if (!projections.length) return;
      if (direct.value) direct.value.mount.projectionsChanged(projections);
      else post({ kind: "projections-changed", projections });
    }).catch(failure => { if (active) reportPanelUnavailable(failure); });
    return applying;
  }

  /** A viewer coming back reconciles the registered panel's revisions with a short read. */
  async function restore(shown: Extract<HostedPanelSource, { kind: "registered" }>) {
    try {
      const snapshot = await port.snapshot(shown.panel.id);
      if (active) await advance(snapshotRevisions(snapshot));
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
    if (shown.kind === "candidate") {
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
    if (shown.kind === "candidate") {
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
      openBridge(true);
      options.reopened?.();
      follow(shown);
      refresh(null);
      if (snapshot) await advance(snapshotRevisions(snapshot));
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    }
  }

  watch(shownToReader, now => {
    const shown = source.value;
    if (!shown) return;
    if (now) {
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

  function refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected) {
    if (!frameReady) pendingObjectRefresh = true;
    else if (direct.value) direct.value.mount.refresh(target, affected);
    else post({ kind: "object-changed", target: target && { ...target } });
  }

  function requestedState(panel: HostedPanelSource["panel"]) {
    return Object.fromEntries(Object.entries(options.initial()).filter(([name]) => panel.manifest.state[name]?.deepLink));
  }

  function syncAddress(): boolean {
    if (!frameReady || !source.value) return false;
    const requested = panelAddress(pageAddress(), requestedState(source.value.panel));
    if (requested === address.value) return false;
    tellAddress(requested);
    return true;
  }
  watch([options.address, options.initial], syncAddress);

  /**
   * The reader saved or discarded the draft the address links: the address drops the link and keeps everything else, and
   * the frame hears it as any address change. From then on the page's address is read without that link, so the page
   * catching up later changes nothing; a late word about an earlier draft never drops a link opened since.
   */
  function settleDraft(draft: PageDraftLink) {
    if (!linksDraft(address.value, draft)) return;
    settledDraft = draft;
    tellAddress(panelAddress(pageAddress(), state.value));
  }

  /** The instance's address changed outside it: the frame hears it as a message, a direct instance as a call. */
  function tellAddress(next: string) {
    frameAddress = next;
    address.value = next;
    if (direct.value) direct.value.mount.address(next);
    else post({ kind: "address", address: next });
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
    if (payload.kind === "draft-settled") settleDraft(payload.draft);
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
    notice,
    admitted,
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
      registration = window && source.value && !runsDirect(source.value) ? port.frame(window, source.value, bridgeOpen) : undefined;
    },
  };
}

/** Whether an address links exactly this draft. */
function linksDraft(address: string, draft: PageDraftLink) {
  const linked = pageDraftLink(Object.fromEntries(new URLSearchParams(address.split("?")[1] ?? "")));
  return linked?.sessionId === draft.sessionId && linked.runId === draft.runId && linked.path === draft.path;
}

/** An address without its draft link, everything else kept. */
function withoutDraftLink(address: string) {
  const [path, search = ""] = address.split("?");
  const query = new URLSearchParams(search);
  for (const key of PAGE_DRAFT_QUERY_KEYS) query.delete(key);
  return query.size ? `${path}?${query}` : path!;
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
