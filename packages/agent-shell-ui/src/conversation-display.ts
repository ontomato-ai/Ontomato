import { computed, nextTick, shallowRef } from "vue";
import type {
  DisplayLoad,
  DisplayPageAddressInput,
  DisplaySnapshot,
  PresentationFrame,
  PresentationReceipt,
} from "@ontomato/contracts/agent-presentation";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { fileName } from "./artifacts";
import type { OpenArtifact, ShellFeatureDeclaration } from "./types";

/**
 * What is shown beside the conversation (design "agent visibility and presentation", sections 3 and 5.2): nothing, an
 * artifact or a page, where it sits and what its own loader last said. This controller is the one place that decides it.
 * A reader's click on a card or a link, the column, closing, enlarging and collapsing, a page's own navigation and its
 * state reports all come here; the host mounts its pages from `page` and nothing else.
 *
 * The browser address is an input and, once a reader's navigation went through, its serialised result — never a second
 * authority. The host reads its address bar into `follow` and writes the reader's navigation through `serialize`.
 */

/** Where a page sits: beside the conversation, or filling the application's area with a composer at its foot. */
export type DisplayView = "side" | "full";

/** A page a host shows here. */
export interface DisplayPage {
  /** The host's feature that draws it. */
  featureId: string;
  /** The page's address, as links and the address bar name it; empty for a host page that has none (the builder's). */
  address: string;
  /**
   * What keeps it the same mounted page while its address changes: a panel writes its selection into its address and stays
   * the panel it was. Leaving an instance is what asks about unsaved changes.
   */
  instance: string;
}

export type DisplayTarget = { kind: "artifact"; open: OpenArtifact } | ({ kind: "page" } & DisplayPage);

/** Whether a reader's navigation adds a step to the browser's history or replaces the current one. */
export type DisplayHistory = "push" | "replace";

export interface ConversationDisplayHost {
  /** The host's page declarations: which pages sit beside the conversation. */
  features: () => readonly ShellFeatureDeclaration[];
  /** The page an address opens here (a link, the address bar); null when it is none of this host's. */
  resolve?: (address: string) => DisplayPage | null;
  /** The page a column entry opens; null when the entry is no page of this display. */
  feature?: (id: string) => DisplayPage | null;
  /**
   * Writes the reader's navigation where a reload and a shared link restore it. Resolves false when the address did not
   * move (a leave guard kept the reader), and then nothing changes here either. A host without one keeps nothing.
   */
  serialize?: (page: DisplayPage | null, view: DisplayView, history: DisplayHistory) => Promise<boolean>;
  /** What a message says about the page: the host's name and address for it, with what the page reported. */
  context: (page: DisplayPage, reported: PageContext | null) => PageContext;
  /** The platform's leave guard for native pages' drafts, and its one question to the reader. */
  leave: { leaves(address: string | null): boolean; confirm(): Promise<boolean> };
  /** What is shown before anything is opened (the builder opens its workspace beside the conversation). */
  initial?: { page: DisplayPage; view: DisplayView };
}

interface Shown {
  target: DisplayTarget | null;
  view: DisplayView;
  /** The reader navigated here, so the address carries it; an artifact is never in the address. */
  restorable: boolean;
}

const READY: DisplayLoad = { status: "ready" };

/**
 * The signal a shown page reads its objects again by (design "long connections" 4): each change counts up `seq`. A
 * `target` is the object an agent changed in this conversation; null asks for everything shown, because what changed
 * while nothing was listening is not known — the page was just opened, or the view's stream is ready again. The same
 * signal reaches the page wherever it sits: beside the conversation, over it, or full.
 */
export type DisplayObjectRefresh = { seq: number; target: PanelObjectIdentity | null };

/** Where the side's own outlet sits now, as the outlet itself sees it: beside the conversation or over it. */
export type DisplayPlacementProbe = () => "side" | "overlay";
type Selected = Extract<DisplaySnapshot, { placement: unknown }>;
/** What the display answers itself: whether it opened the target, and why not. */
export type DisplayPresentationResult = PresentationReceipt["result"];
type NotOpenedReason = Extract<DisplayPresentationResult, { status: "not_opened" }>["reason"];

export function useConversationDisplay(host: ConversationDisplayHost) {
  const shown = shallowRef<Shown>({
    target: host.initial ? { kind: "page", ...host.initial.page } : null,
    view: host.initial?.view ?? "full",
    restorable: host.initial !== undefined,
  });
  /** What the shown page instance reported about itself; another instance starts without. */
  const reported = shallowRef<PageContext | null>(null);
  const load = shallowRef<DisplayLoad>(READY);
  const objectRefresh = shallowRef<DisplayObjectRefresh | null>(null);
  function refreshObjects(target: PanelObjectIdentity | null) {
    objectRefresh.value = { seq: (objectRefresh.value?.seq ?? 0) + 1, target };
  }
  /** Whether the shown page instance (a panel) holds unsaved changes; native pages answer through `host.leave`. */
  let unsaved = false;
  /** The page address a serialisation is writing: the address bar arriving there is this controller's own write. */
  let writing: string | null | undefined;
  /**
   * The reader's operations take effect in the order they were made (design 5.3): each starts from what the one before
   * it left, the address included, so closing a page and opening another in one gesture cannot interleave their writes.
   */
  let settled: Promise<unknown> = Promise.resolve();
  function inOrder<T>(operation: () => Promise<T>): Promise<T> {
    const next = settled.then(operation);
    settled = next.catch(() => {});
    return next;
  }
  /** The outlet drawing the side now reports its own form; the breakpoint is its style's, not repeated here. */
  let placement: DisplayPlacementProbe | null = null;

  const target = computed(() => shown.value.target);
  const page = computed<DisplayPage | null>(() => (shown.value.target?.kind === "page" ? shown.value.target : null));
  const feature = computed(() => host.features().find((entry) => entry.id === page.value?.featureId) ?? null);
  const pageContext = computed(() => (page.value ? host.context(page.value, reported.value) : null));

  function commit(next: Shown) {
    const current = shown.value.target;
    const sameInstance =
      current?.kind === "page" && next.target?.kind === "page" && current.instance === next.target.instance;
    if (!sameInstance) {
      reported.value = null;
      load.value = READY;
      unsaved = false;
    }
    shown.value = next;
    // A page opened anew reads what it shows from its owner, whatever happened while it was not open.
    if (!sameInstance && next.target?.kind === "page") refreshObjects(null);
  }

  /** Whether going to `next` leaves the shown page instance while it holds unsaved changes. */
  function dropsUnsaved(next: DisplayTarget | null): boolean {
    const current = page.value;
    if (!current || (next?.kind === "page" && next.instance === current.instance)) return false;
    return unsaved || host.leave.leaves(next?.kind === "page" ? next.address : null);
  }

  /** Leaving the shown page instance with unsaved changes asks the reader first; staying in it never asks. */
  async function mayLeave(next: DisplayTarget | null): Promise<boolean> {
    return !dropsUnsaved(next) || host.leave.confirm();
  }

  /** One observation of what is shown, for a presentation result. */
  function snapshot(): DisplaySnapshot {
    const observedAt = new Date().toISOString();
    return shown.value.target ? selected(observedAt) : { known: true, observedAt, target: null };
  }
  function selected(observedAt = new Date().toISOString()): Selected {
    const current = shown.value.target!;
    const full = current.kind === "page" && (shown.value.view === "full" || !feature.value?.withConversation);
    const where = full ? "full-page" : placement!();
    if (current.kind === "artifact") {
      const { runId, path } = current.open.artifact;
      return { known: true, observedAt, placement: where, target: { kind: "artifact", runId, path, title: current.open.title }, load: load.value };
    }
    return { known: true, observedAt, placement: where, target: { kind: "page", ...pageContext.value! }, load: load.value };
  }

  function notOpened(reason: NotOpenedReason, error?: { code: string; message: string }): DisplayPresentationResult {
    return { status: "not_opened", reason, current: snapshot(), ...(error ? { error } : {}) };
  }

  /** What an agent asked to show: an artifact the host resolved, or a page address with the state it opens at. */
  function presented(frame: PresentationFrame): DisplayTarget | NotOpenedReason | { error: { code: string; message: string } } {
    if (frame.target.kind === "artifact") {
      const { artifact } = frame.target;
      return { kind: "artifact", open: { key: `${artifact.runId}:${artifact.path}`, artifact, title: fileName(artifact.path) } };
    }
    let address = frame.target.address;
    // The state a page opens at rides in its address, as a reader's link carries it; a value no panel state can hold
    // is refused here, at the edge where it arrives.
    if (frame.target.state !== undefined) {
      try {
        address = panelAddress(address, frame.target.state);
      } catch (error) {
        return { error: { code: "invalid_state", message: error instanceof Error ? error.message : String(error) } };
      }
    }
    const next = host.resolve?.(address) ?? null;
    return next ? { kind: "page", ...next } : "unsupported_target";
  }

  async function write(next: DisplayPage | null, view: DisplayView, history: DisplayHistory): Promise<boolean> {
    if (!host.serialize) return true;
    writing = next?.address ?? null;
    try {
      return await host.serialize(next, view, history);
    } finally {
      writing = undefined;
    }
  }

  /** The reader opens a page: guarded, written to the address, and only then shown. */
  function open(next: DisplayPage, options: { view?: DisplayView; history: DisplayHistory }): Promise<boolean> {
    return inOrder(async () => {
      const view = options.view ?? shown.value.view;
      const nextTarget: DisplayTarget = { kind: "page", ...next };
      if (!(await mayLeave(nextTarget))) return false;
      if (!(await write(next, view, options.history))) return false;
      commit({ target: nextTarget, view, restorable: true });
      return true;
    });
  }

  /** An address the reader navigated to: a link, a page's own move, a panel's request for another of its pages. */
  function navigate(address: string, options: { view?: DisplayView; history: DisplayHistory }): Promise<boolean> {
    const next = host.resolve?.(address) ?? null;
    return next ? open(next, options) : Promise.resolve(false);
  }

  /** A page's report that its own state moved: the address follows, but it is not the reader navigating. */
  function state(address: string) {
    const current = shown.value;
    const next = host.resolve?.(address) ?? null;
    if (current.target?.kind !== "page" || next?.instance !== current.target.instance) return;
    if (next.address === current.target.address) return;
    shown.value = { ...current, target: { kind: "page", ...next } };
    // Only a page the reader navigated to is in the address; a presented one stays out of it.
    if (current.restorable) void write(next, current.view, "replace");
  }

  return {
    target,
    page,
    feature,
    view: computed(() => shown.value.view),
    restorable: computed(() => shown.value.restorable),
    pageContext,
    load: computed(() => load.value),
    /** What the shown page reads its objects again by; it keeps counting across pages. */
    objectRefresh: computed(() => objectRefresh.value),
    refreshObjects,

    /** Whether an in-app address opens a page of this display. */
    resolves: (address: string) => (host.resolve?.(address) ?? null) !== null,
    navigate,

    /** A column entry: the page it names, unless that page is already the one shown. */
    openFeature(id: string, view?: DisplayView): Promise<boolean> {
      if (page.value?.featureId === id) return Promise.resolve(true);
      const next = host.feature?.(id) ?? null;
      return next ? open(next, { view, history: "push" }) : Promise.resolve(false);
    },

    /** A page shown before: the conversation's corner opens the one that last left the side. */
    reopen: (next: DisplayPage) => open(next, { view: "side", history: "push" }),

    /** The reader opened a card. An artifact is not in the address: a page it replaces leaves the address too. */
    openArtifact: (open: OpenArtifact) =>
      inOrder(async () => {
        const next: DisplayTarget = { kind: "artifact", open };
        if (!(await mayLeave(next))) return false;
        if (page.value && !(await write(null, shown.value.view, "replace"))) return false;
        commit({ target: next, view: shown.value.view, restorable: false });
        return true;
      }),

    /** Closing returns to the conversation alone. A closed page leaves the next one to open full, as a column entry does. */
    close: () =>
      inOrder(async () => {
        if (!(await mayLeave(null))) return false;
        const view = page.value ? "full" : shown.value.view;
        if (page.value && !(await write(null, view, "replace"))) return false;
        commit({ target: null, view, restorable: false });
        return true;
      }),

    /** Enlarging and collapsing the shown page. */
    setView: (view: DisplayView) =>
      inOrder(async () => {
        const current = page.value;
        if (!current || view === shown.value.view) return true;
        if (shown.value.restorable && !(await write(current, view, "push"))) return false;
        commit({ ...shown.value, view });
        return true;
      }),

    /**
     * The address bar moved: a reload, the browser's back and forward, a link from elsewhere. Its own guard already ran.
     * `view` is what the address says about it, where it says anything (the settings at their own address are full).
     */
    follow(address: string | null, view?: DisplayView) {
      if (writing !== undefined && address === writing) return;
      const current = shown.value;
      const next = address === null ? null : host.resolve?.(address) ?? null;
      if (!next) {
        // An address without a page closes only a page the address carried; a card or a presented page was never in it.
        if (current.target?.kind === "page" && current.restorable) commit({ target: null, view: "full", restorable: false });
        return;
      }
      const nextView = view ?? current.view;
      if (current.target?.kind === "page" && current.target.address === next.address && current.view === nextView) return;
      commit({ target: { kind: "page", ...next }, view: nextView, restorable: true });
    },

    /*
     * What a page or a panel beside the conversation hands its display. `address` is either the reader's explicit
     * navigation or the instance echoing its own state; `context` what the reader looks at; `loaded` what its loader knows;
     * `dirty` whether leaving it now would drop unsaved changes.
     */
    address(input: DisplayPageAddressInput) {
      if (input.kind === "navigate") void navigate(input.address, { history: "replace" });
      else state(input.address);
    },
    context(context: PageContext) {
      reported.value = context;
    },
    loaded(next: DisplayLoad) {
      load.value = next;
    },
    dirty(value: boolean) {
      unsaved = value;
    },

    /** The outlet drawing the side reports where it sits; it takes the report back when it goes. */
    placed(probe: DisplayPlacementProbe): () => void {
      placement = probe;
      return () => {
        if (placement === probe) placement = null;
      };
    },

    snapshot,

    /**
     * An agent's request to show something (design 5): in turn with the reader's own operations, never over unsaved
     * changes, beside the conversation, and out of the address — a reload does not show it again, and the page the
     * reader had navigated to leaves the address once it has been replaced. The result is what is shown once the switch
     * is drawn, with what its loader knows by then.
     */
    present: (frame: PresentationFrame) =>
      inOrder(async (): Promise<DisplayPresentationResult> => {
        const next = presented(frame);
        if (typeof next === "string") return notOpened(next);
        if (!("kind" in next)) return notOpened("unsupported_target", next.error);
        const current = shown.value;
        const same =
          current.target?.kind === next.kind &&
          (next.kind === "artifact" ? current.target.kind === "artifact" && current.target.open.key === next.open.key
            : current.target.kind === "page" && current.target.address === next.address);
        if (!same) {
          if (dropsUnsaved(next)) return notOpened("blocked_unsaved");
          commit({ target: next, view: next.kind === "page" ? "side" : current.view, restorable: false });
          if (current.restorable) await write(null, shown.value.view, "replace");
        }
        await nextTick();
        const shownNow = selected();
        return shownNow.load.status === "error"
          ? { status: "opened", reason: "load_error", current: shownNow, ...(shownNow.load.error ? { error: shownNow.load.error } : {}) }
          : { status: "opened", reason: "target_selected", current: shownNow };
      }),
  };
}

export type ConversationDisplay = ReturnType<typeof useConversationDisplay>;

/**
 * How an in-app link in an answer opens: a page of the display beside the conversation, as the reader's own step; any
 * other page by the host's own way (`others`, another application's address); null leaves it as text.
 */
export function displayLink(display: ConversationDisplay, others?: (href: string) => (() => void) | null) {
  return (href: string): (() => void) | null =>
    display.resolves(href) ? () => void display.navigate(href, { view: "side", history: "push" }) : others?.(href) ?? null;
}
