import { inject, onBeforeUnmount, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import {
  PANEL_HOST_CHANNEL,
  panelAddress,
  panelAddressState,
  panelFrameMessageSchema,
  panelMessageOf,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { PanelOperation, PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
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
 * What the platform gives a panel host. A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`)
 * and a panel's record is Node's (`GET /api/product-panels/:id`); both check the reader's use themselves.
 */
export interface PanelHostPort {
  /** The application whose use relation this instance opens. */
  applicationId(): string;
  /** That application's use relations, as Java declares them. */
  uses(applicationId: string): Promise<readonly ApplicationPanelUse[]>;
  /** One panel's current record, read under the use relation's Grant. */
  panel(panelId: string): Promise<ProductPanel>;
  /** The SDK version's module base this panel runs with, e.g. `/apps-sdk/1.1.0`. */
  sdkBase(): Promise<string>;
  /**
   * Registers the frame the panel runs in: the platform's execution binding and identity for the page it shows, and what
   * the frame may ask the platform for, which the panel's current record declares.
   */
  frame(frame: Window, use: ApplicationPanelUse, panel: ProductPanel): () => void;
  /**
   * Hears "definition changed" for the definitions this instance shows: the panel and every projection its declaration
   * names. Events carry identity only. The returned function stops the notices.
   */
  subscribe(targets: readonly DefinitionTarget[], listener: (event: DefinitionChanged) => void): () => void;
}

/** One definition a panel instance shows, by kind and ID. */
export interface DefinitionTarget {
  kind: "panel" | "projection";
  id: string;
}

/** The platform's notice that a projection's or a panel's current definition changed; it carries identity only. */
export interface DefinitionChanged {
  kind: "definition-changed";
  domainId: string;
  target: { kind: "projection" | "panel"; id: string };
}

export const panelHostKey: InjectionKey<PanelHostPort> = Symbol("panel-host");

/** The platform's panel host, or nothing where panels cannot be opened. */
export function usePanelHostPort(): PanelHostPort | null {
  return inject(panelHostKey, null);
}

/** One running panel instance: its use, its record, the frame it runs in and what it reports. */
export interface PanelInstanceView {
  readonly use: Ref<ApplicationPanelUse | null>;
  readonly panel: Ref<ProductPanel | null>;
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
  /** Resolves once the use relation and the record are read. */
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
  /** The page names a use relation its application does not declare. */
  useMissing(useId: string): string;
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
  /** The application use to open; changing it is another instance. */
  useId: () => string;
  /** What a message calls the page: the panel's own name, and whatever the page adds to it (its application, say). */
  label: (panel: ProductPanel) => string;
  /**
   * The page's address as the reader and a message see it — the application's address plus the relation's path, without
   * any state. The instance's declared deep-linkable state is added to it here, and that is the only thing the address
   * carries beyond the page itself: no credential and no form value ever goes into it.
   */
  address: () => string;
  /**
   * The state the page was opened at, as the address named it: the instance starts from this, and never re-reads the
   * address afterwards. A reader's selection is reported upward, so the page writes it into the address — and reading it
   * back here would fight that write and rebuild the instance.
   */
  initial: () => Record<string, unknown>;
}

/** What a failure is called in the panel's error place: its own message, or what it was, verbatim. */
const failureText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/**
 * Loads one panel instance from its use relation and keeps it current. The instance is this composable's alone: two
 * callers of the same panel hold two states, and neither sees the other's selection.
 */
export function usePanelInstance(port: PanelHostPort, options: PanelInstanceOptions): PanelInstanceView {
  const use = shallowRef<ApplicationPanelUse | null>(null);
  const panel = shallowRef<ProductPanel | null>(null);
  const pageContext = shallowRef<PageContext | null>(null);
  const document = shallowRef("");
  const error = shallowRef("");
  const state = shallowRef<Record<string, PanelStateValue>>({});
  const address = shallowRef("");
  const operations = shallowRef<readonly PanelOperation[]>([]);
  let frame: Window | null = null;
  let disposeFrame: (() => void) | undefined;
  let loadedPanelId: string | null = null;
  /** The record read while the frame had unsaved changes: shown as soon as the reader saves or drops them. */
  let waiting: ProductPanel | null = null;
  const answering = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let settle: () => void = () => {};
  const ready = new Promise<void>((resolve) => (settle = resolve));

  /**
   * Reads what this instance needs: the use relation, the panel's current record and the SDK base its frame runs on.
   * Whatever fails is reported where the panel would have been — a page that cannot say why it is empty is worse than one
   * that says what it could not read.
   */
  async function load() {
    error.value = "";
    try {
      const applicationId = port.applicationId();
      const relations = await port.uses(applicationId);
      const relation = relations.find((candidate) => candidate.id === options.useId());
      if (!relation) throw new Error(options.labels.useMissing(options.useId()));
      await adopt(relation, await port.panel(relation.panelId));
      loadedPanelId = relation.panelId;
      stopNotices = port.subscribe(targets(), notice);
    } catch (failure) {
      error.value = failureText(failure);
    }
    settle();
  }

  async function adopt(relation: ApplicationPanelUse, record: ProductPanel) {
    // The SDK base is read before the record is kept, so a version this platform cannot serve shows as an error rather
    // than as an empty frame.
    const base = await port.sdkBase();
    use.value = relation;
    panel.value = record;
    // The state the page was opened at is checked against the panel's own declaration, so a link never sets another
    // field. It is read once, at load: after that the instance is what the address follows, not the other way round.
    state.value = Object.fromEntries(
      Object.entries(options.initial()).filter(([name]) => record.manifest.state[name]?.deepLink),
    ) as Record<string, PanelStateValue>;
    address.value = panelAddress(options.address(), state.value);
    const message: PanelHostMessage = {
      kind: "panel-host-message",
      panel: record,
      pageKey: relation.pageKey,
      url: address.value,
      // What a message calls the page: the panel's own registered name, which its author wrote, with the application's
      // when the page passes one.
      label: options.label(record),
      state: state.value,
    };
    document.value = panelFrameDocument(record, base, message, options.labels.failures);
    if (frame) {
      disposeFrame?.();
      disposeFrame = port.frame(frame, relation, record);
    }
  }

  watch(options.useId, () => void load(), { immediate: true });

  // What this instance watches: its own panel, and every projection its declaration names — the whole of X, not the
  // slots that happen to be drawn.
  let stopNotices: (() => void) | undefined;
  function notice(event: DefinitionChanged) {
    if (!use.value) return;
    // A changed projection is only read by the instances that use it: the panel's own declaration says which.
    if (event.target.kind === "projection") {
      const used = Object.values(panel.value?.manifest.slots ?? {}).some(
        (slot) => slot.projectionId === event.target.id,
      );
      if (used) post({ kind: "projection-changed", projectionId: event.target.id });
      return;
    }
    // A changed panel: read again by its ID, but never over a form the reader has unsaved.
    if (event.target.id !== loadedPanelId) return;
    port.panel(event.target.id).then(
      (record) => {
        if (dirty()) waiting = record;
        else if (use.value) void adopt(use.value, record).catch((failure: unknown) => (error.value = failureText(failure)));
      },
      (failure: unknown) => (error.value = failureText(failure)),
    );
  }
  onBeforeUnmount(() => stopNotices?.());

  /** The definitions this instance shows, once its record is read. */
  function targets(): DefinitionTarget[] {
    const record = panel.value;
    if (!record) return [];
    return [
      { kind: "panel" as const, id: record.id },
      ...[...new Set(Object.values(record.manifest.slots).map((slot) => slot.projectionId))].map(
        (id) => ({ kind: "projection" as const, id }),
      ),
    ];
  }

  let unsaved = false;
  function dirty() {
    return unsaved;
  }

  function post(message: unknown) {
    frame?.postMessage({ channel: PANEL_HOST_CHANNEL, ...(message as object) }, "*");
  }

  function message(event: MessageEvent) {
    if (event.source !== frame) return;
    const payload = panelMessageOf(panelFrameMessageSchema, event);
    if (!payload) return;
    if (payload.kind === "context") pageContext.value = payload.context;
    if (payload.kind === "state") {
      state.value = payload.state;
      address.value = panelAddress(options.address(), payload.state);
    }
    if (payload.kind === "operations") operations.value = payload.operations;
    if (payload.kind === "dirty") {
      unsaved = payload.dirty;
      // The reader saved or dropped their changes: now the record read while they were editing may be shown.
      if (!unsaved && waiting) {
        const record = waiting;
        waiting = null;
        if (use.value) void adopt(use.value, record).catch((failure: unknown) => (error.value = failureText(failure)));
      }
    }
    if (payload.kind === "failed") {
      // The frame could not run its panel. The reason goes where the panel would have been, and no frame is drawn over it.
      error.value = payload.message;
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
  onBeforeUnmount(() => {
    window.removeEventListener("message", message);
    disposeFrame?.();
  });

  return {
    use,
    panel,
    pageContext,
    document,
    state,
    address,
    operations,
    error,
    ready,
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
      disposeFrame?.();
      disposeFrame = window && use.value && panel.value ? port.frame(window, use.value, panel.value) : undefined;
    },
  };
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
  function fail(what) {
    if (reported || !what) return;
    reported = true;
    window.parent.postMessage({ channel: "${PANEL_HOST_CHANNEL}", kind: "failed", message: String(what).slice(0, 1900) }, "*");
  }
  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && target.tagName) fail(words.fileUnavailable.replace("{file}", target.src || target.href || target.tagName.toLowerCase()));
    else fail(event.message || (event.error && event.error.message) || words.scriptThrew);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    fail((reason && reason.message) || reason || words.scriptRejected);
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
  record: ProductPanel,
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
