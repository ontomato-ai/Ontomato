import { inject, onBeforeUnmount, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import {
  PANEL_HOST_CHANNEL,
  panelAddressState,
  panelFrameMessageSchema,
  panelAddress,
  type PanelHostMessage,
} from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";

/*
 * A panel instance in the platform (overall design 3.4, "generic PanelHost"): the same component shows the panel full
 * screen, beside a conversation and inside another application, because all three only need a use relation, the current
 * record and somewhere to show it. The panel's own text runs in a frame of its own, with this SDK version's modules, so
 * a panel is portable across the applications that use it.
 *
 * What the host does, and a panel's author therefore does not: read the use relation and the record, keep the declared
 * deep-linkable state in the address, hand the reader's page context to whoever writes the message, and re-read the
 * record by its ID when the platform says its definition changed — never over a form the reader has unsaved.
 */

/**
 * What the platform gives a panel host. Reading a use relation and a panel record are the platform's own calls: Java
 * owns the use relations, Node the current records, and both check the reader's use themselves.
 */
export interface PanelHostPort {
  /** The application's use relation this instance opens: its page key, path and access. */
  use(useId: string): Promise<ApplicationPanelUse>;
  /** The panel's current record, read under that use's Grant. */
  panel(panelId: string): Promise<ProductPanel>;
  /** The SDK version's module base this panel runs with, e.g. `/apps-sdk/1.1.0`. */
  sdkBase(): Promise<string>;
  /**
   * Registers the frame the panel runs in, so the platform knows the execution and the identity of the page it shows;
   * the returned function runs when the frame goes. A host that shows panels in the platform's own frame passes the
   * platform's registration here.
   */
  frame(frame: Window, use: ApplicationPanelUse): () => void;
  /** Hears "definition changed" for this domain; the returned function stops it. */
  subscribe?(listener: (event: DefinitionChanged) => void): () => void;
}

/** The platform's internal notice that a projection's or a panel's current definition changed; it carries identity only. */
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
  /** The address this instance shows, with its state; never a credential or a form value. */
  readonly address: Ref<string>;
  readonly error: Ref<string>;
  /** Resolves once the use relation and the record are read; a host that awaits it has the instance's address. */
  readonly ready: Promise<void>;
  /** The frame's content window, once it exists. */
  frame(window: Window | null): void;
}

export interface PanelInstanceOptions {
  /** The application use to open; changing it is another instance. */
  useId: () => string;
  /** The name a message gives the page, e.g. the panel's name or the application's. */
  label: () => string;
}

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
  let frame: Window | null = null;
  let disposeFrame: (() => void) | undefined;
  let loadedPanelId: string | null = null;
  let settle: () => void = () => {};
  const ready = new Promise<void>((resolve) => (settle = resolve));

  async function load(useId: string) {
    error.value = "";
    const relation = await port.use(useId);
    use.value = relation;
    await adopt(await port.panel(relation.panelId));
    loadedPanelId = relation.panelId;
    settle();
  }

  async function adopt(record: ProductPanel) {
    const base = await port.sdkBase();
    panel.value = record;
    // The state an address restores is checked against the panel's own declaration, so a link never sets another field.
    state.value = Object.fromEntries(
      Object.entries(panelAddressState(address.value || use.value!.path)).filter(
        ([name]) => record.manifest.state[name]?.deepLink,
      ),
    ) as Record<string, PanelStateValue>;
    address.value = panelAddress(use.value!.path, state.value);
    document.value = panelFrameDocument(record, base, {
      kind: "panel-host-message",
      panel: record,
      pageKey: use.value!.pageKey,
      url: address.value,
      label: options.label(),
      state: state.value,
    });
    if (frame) {
      disposeFrame?.();
      disposeFrame = port.frame(frame, use.value!);
    }
  }

  watch(
    options.useId,
    (useId) => {
      void load(useId);
    },
    { immediate: true },
  );

  // A changed definition is read again by its ID: the panel itself, or a projection it contains (which the panel's
  // record is shown from, so its text and declaration are read again with it).
  onBeforeUnmount(() => undefined);
  const stop = port.subscribe?.((event) => {
    if (event.target.kind !== "panel" || event.target.id !== loadedPanelId) return;
    void port.panel(event.target.id).then(adopt);
  });
  onBeforeUnmount(() => stop?.());

  function message(event: MessageEvent) {
    if (event.source !== frame || event.data?.channel !== PANEL_HOST_CHANNEL) return;
    const parsed = panelFrameMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (parsed.data.kind === "context") pageContext.value = parsed.data.context;
    if (parsed.data.kind === "state") {
      state.value = parsed.data.state;
      address.value = panelAddress(use.value!.path, parsed.data.state);
    }
  }
  window.addEventListener("message", message);
  onBeforeUnmount(() => window.removeEventListener("message", message));

  return {
    use,
    panel,
    pageContext,
    document,
    state,
    address,
    error,
    ready,
    frame(window) {
      frame = window;
      disposeFrame?.();
      disposeFrame = window && use.value ? port.frame(window, use.value) : undefined;
      window?.parent.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "ready" }, "*");
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
};

/**
 * The document one panel instance runs in: this SDK version's import map and stylesheet, the panel's HTML, its record as
 * the run's facts, and its module. The panel's text is content, so its module is inserted as text.
 */
export function panelFrameDocument(record: ProductPanel, sdkBase: string, message: PanelHostMessage): string {
  const imports = Object.fromEntries(
    Object.entries(MODULES).map(([specifier, file]) => [specifier, `${sdkBase}/${file}`]),
  );
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<link rel="stylesheet" href="${sdkBase}/styles/sdk.css">`,
    '<script type="importmap">',
    escapeForElement(JSON.stringify({ imports })),
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
