import { displayLoadSchema, PANEL_LOAD_ERROR_CODES, type DisplayLoad } from "@ontomato/contracts/agent-presentation";
import type { PanelDefinitionSnapshot, ProductDefinitionRevision, ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { inject, onScopeDispose, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef } from "vue";
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
import type { PanelOperation, PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { PanelDefinitionContent, ProductPanel } from "@ontomato/contracts/product-panels";
import { randomId } from "@ontomato/contracts/random-id";

/*
 * A panel instance in the platform (overall design 3.4, "generic PanelHost"): the same component shows the panel full
 * screen, beside a conversation and inside another application, because all three only need a use relation, the current
 * record and somewhere to show it. The panel's own text runs in a frame of its own, with this SDK version's modules, so
 * a panel is portable across the applications that use it.
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
export interface PanelHostPort<Source extends PanelHostSource = PanelHostSource> {
  /** What this instance shows. A candidate is read again when the reader comes back to the page. */
  source(): Promise<Source>;
  /** The page key a draft for this page names: the use relation's, or the one the candidate is previewed as. */
  readonly pageKey: string;
  /** A registered panel's current record, read again when its revision moves. */
  panel(panelId: string): Promise<ProductPanel>;
  /** Where the platform serves its SDK builds, e.g. `/apps-sdk`: a definition's frame loads `<root>/<its sdkVersion>`. */
  sdkRoot(): Promise<string>;
  /**
   * Registers the frame the panel runs in: the execution context and identity for the page it shows, what the frame
   * may ask the platform for, which the source's manifest declares, and whether it may ask for anything now.
   */
  frame(frame: Window, source: Source, open: boolean): PanelFrameRegistration;
  snapshot(panelId: string): Promise<PanelDefinitionSnapshot>;
  /**
   * Whether the use relation this host opens is still the application's, bound to the same panel: what a kept page is
   * checked against when it is shown again. A candidate has no relation to check.
   */
  current?(): Promise<boolean>;
  /**
   * The check a page opened ahead of Java's answer waits for: whether that answer names its use relation, bound to the
   * same panel. The frame is drawn only once it has passed. Absent when the relation was already Java's answer.
   */
  admitted?: Promise<boolean>;
  mode: PanelDefinitionMode;
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
export interface PanelInstanceView extends PanelRefreshPort {
  /** What the instance shows, once read: the registered use and record, or the workspace candidate. */
  readonly source: Ref<PanelHostSource | null>;
  /** What a message from this instance carries now; null until the panel's module reports. */
  readonly pageContext: Readonly<ShallowRef<PageContext | null>>;
  /** The message written into the frame's document; null while the record is being read. */
  readonly document: Readonly<Ref<string>>;
  /** The reader's deep-linkable state, as the address carries it. */
  readonly state: Ref<Record<string, PanelStateValue>>;
  /** The instance's address, with its state; never a credential or a form value. */
  readonly address: Ref<string>;
  /** The operations the instance offers, as its frame reported them. */
  readonly operations: Readonly<Ref<readonly PanelOperation[]>>;
  readonly error: Ref<string>;
  readonly displayLoad: Readonly<ShallowRef<DisplayLoad>>;
  readonly dirty: Readonly<ShallowRef<boolean>>;
  /** Resolves once the source is read. */
  readonly ready: Promise<void>;
  /** A person clicked one of those operations: the frame runs it, and the promise settles with its answer. */
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
}

export interface PanelInstanceOptions {
  /** The words the host shows the reader. */
  labels: PanelHostLabels;
  /** What a message calls the page: the registered panel's own name, and whatever the page adds to it, or the page's word for a candidate. */
  label: (source: PanelHostSource) => string;
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
  const source = shallowRef<PanelHostSource | null>(null);
  const pageContext = shallowRef<PageContext | null>(null);
  const document = shallowRef("");
  const error = shallowRef("");
  const displayLoad = shallowRef(loading);
  const dirty = shallowRef(false);
  const state = shallowRef<Record<string, PanelStateValue>>({});
  const address = shallowRef("");
  const operations = shallowRef<readonly PanelOperation[]>([]);
  let frame: Window | null = null;
  let sdkRoot = "";
  let frameReady = false;
  let frameAddress = "";
  let registration: PanelFrameRegistration | undefined;
  /** Whether the frame may ask the platform for anything: not while its page is kept out of view, nor until it is checked. */
  let bridgeOpen = true;
  let active = true;
  let author: ReturnType<Extract<PanelDefinitionMode, { kind: "author" }>["definitions"]["observe"]> | undefined;
  const pending = new Map<string, ProductDefinitionRevision>();
  /** A candidate read again whose definition differs from the one shown; it waits like a changed record does. */
  let pendingCandidate: PanelHostSource | null = null;
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
      // The source, the SDK root and the relation check do not depend on one another: they are read side by side. The
      // record just read is the current definition, so opening needs no snapshot of it besides.
      const [read, root, admitted] = await Promise.all([port.source(), port.sdkRoot(), port.admitted ?? true]);
      if (!active) return;
      if (!admitted) {
        options.withdrawn?.();
        return;
      }
      sdkRoot = root;
      adopt(read);
      if (port.mode.kind === "author") follow(read);
    } catch (failure) {
      if (active) reportPanelUnavailable(failure);
    } finally {
      settle();
    }
  }

  function adopt(next: PanelHostSource) {
    error.value = "";
    const requested = requestedState(next.panel) as Record<string, PanelStateValue>;
    const requestedAddress = panelAddress(pageAddress(), requested);
    const { content, manifest, sdkVersion } = next.panel;
    // Only the renderable definition crosses into the frame; the record's identity and a candidate's preview context stay
    // with the host.
    const message: PanelHostMessage = {
      kind: "panel-host-message",
      panel: { content, manifest, sdkVersion },
      pageKey: port.pageKey,
      url: requestedAddress,
      // What a message calls the page: the panel's own registered name, which its author wrote, with the application's
      // when the page passes one.
      label: options.label(next),
      state: requested,
    };
    const written = panelFrameDocument(message.panel, `${sdkRoot}/${sdkVersion}`, message, options.labels.failures);
    source.value = next;
    // A new revision with the same definition is the document the frame already runs: it keeps its instance.
    if (written === document.value) return;
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

  function snapshotRevisions(snapshot: PanelDefinitionSnapshot): ProductDefinitionRevision[] {
    return [
      { kind: "panel", ...snapshot.panel },
      ...snapshot.projections.map(projection => ({ kind: "projection" as const, ...projection })),
    ];
  }

  /** A registered panel and its projections; a candidate has no panel record, only the registered projections it names. */
  function targetsOf(shown: PanelHostSource): ProductDefinitionTarget[] {
    return [
      ...(shown.kind === "registered" ? [{ kind: "panel" as const, id: shown.panel.id }] : []),
      ...Object.values(shown.panel.manifest.slots).map(({ projectionId }) => ({ kind: "projection" as const, id: projectionId })),
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
        adopt(next);
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
          const next = { ...shown, panel: record };
          adopt(next);
          author?.replace(targetsOf(next));
          return;
        }
      }
      const projectionIds = new Set(Object.values(shown.panel.manifest.slots).map(slot => slot.projectionId));
      const projections = [...pending.values()]
        .filter(revision => revision.kind === "projection" && projectionIds.has(revision.id))
        .map(({ id, revision }) => ({ id, revision }));
      pending.clear();
      if (projections.length) post({ kind: "projections-changed", projections });
    }).catch(failure => { if (active) reportPanelUnavailable(failure); });
    return applying;
  }

  /** A viewer coming back reconciles the registered panel's revisions with a short read. */
  async function restore(shown: Extract<PanelHostSource, { kind: "registered" }>) {
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
  async function rereadCandidate(shown: PanelHostSource) {
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
  function follow(shown: PanelHostSource) {
    if (shownToReader()) author = port.mode.kind === "author" ? port.mode.definitions.observe(targetsOf(shown), advance, reportPanelUnavailable) : undefined;
  }

  /**
   * The document came back to the foreground with this page shown: the objects it shows are read again, and a viewer's
   * definition revisions are checked beside that read; a changed definition is adopted as any is, never over an unsaved
   * form.
   */
  function resume(shown: PanelHostSource) {
    if (shown.kind === "candidate") {
      void rereadCandidate(shown);
      return;
    }
    refresh(null);
    if (port.mode.kind === "view") void restore(shown);
  }

  function openBridge(open: boolean) {
    bridgeOpen = open;
    registration?.open(open);
  }

  /**
   * A kept page shown again. Its frame is in view at once, but asks for nothing until the host has checked the page is
   * still the reader's — its use relation, and the current definitions the reader may use, read side by side. Then the
   * objects it shows are read again, whether or not anything changed, and a changed definition is adopted as any is. A
   * relation withdrawn or bound elsewhere ends the instance; a refused check is shown where the panel is.
   */
  async function reopen(shown: PanelHostSource) {
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

  const refresh: PanelRefreshPort["refresh"] = target => {
    if (frameReady) post({ kind: "object-changed", target: target && { ...target } });
    else pendingObjectRefresh = true;
  };

  function requestedState(panel: PanelDefinitionContent) {
    return Object.fromEntries(Object.entries(options.initial()).filter(([name]) => panel.manifest.state[name]?.deepLink));
  }

  function syncAddress(): boolean {
    if (!frameReady || !source.value) return false;
    const requested = panelAddress(pageAddress(), requestedState(source.value.panel));
    if (requested === address.value) return false;
    frameAddress = requested;
    address.value = requested;
    post({ kind: "address", address: requested });
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
    const settled = panelAddress(pageAddress(), state.value);
    frameAddress = settled;
    address.value = settled;
    post({ kind: "address", address: settled });
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
    if (payload.kind === "state") {
      if (payload.fromAddress !== frameAddress) return;
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
      state.value = payload.state;
      address.value = panelAddress(pageAddress(), payload.state);
    }
    if (payload.kind === "draft-settled") settleDraft(payload.draft);
    if (payload.kind === "operations") operations.value = payload.operations;
    if (payload.kind === "dirty") {
      dirty.value = payload.dirty;
      if (!dirty.value && (pending.size || pendingCandidate)) void applyPending();
    }
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
    invoke(id, input) {
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

/** The module file of each public specifier this SDK version serves (its `build.mjs` entries). */
const MODULES: Readonly<Record<string, string>> = {
  vue: "vue.js",
  "element-plus": "element-plus.js",
  echarts: "echarts.js",
  "@ontomato/sdk": "sdk.js",
  "@ontomato/sdk/chart": "chart.js",
  "@ontomato/sdk/markdown": "markdown.js",
  "@ontomato/sdk/form": "form.js",
  "@ontomato/sdk/code": "code.js",
  "@ontomato/sdk/preview": "preview.js",
  "@ontomato/sdk/chat": "chat.js",
  "@ontomato/sdk/panel": "panel.js",
  "@ontomato/sdk/base": "base.js",
};

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
  sdkBase: string,
  message: PanelHostMessage,
  failures: PanelHostLabels["failures"],
): string {
  const imports = Object.fromEntries(
    Object.entries(MODULES).map(([specifier, file]) => [specifier, `${sdkBase}/${file}`]),
  );
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<link rel="stylesheet" href="${sdkBase}/styles/sdk.css">`,
    '<script type="importmap">',
    escapeForElement(JSON.stringify({ imports })),
    "</script>",
    "<script>",
    escapeForElement(failureListener(failures)),
    "</script></head><body>",
    record.content.html,
    '<script type="application/json" data-panel-host-message>',
    escapeForElement(JSON.stringify(message)),
    "</script>",
    '<script type="module">',
    escapeForElement(record.content.module),
    "</script></body></html>",
  ].join("\n");
}
