/**
 * Registration for a panel-local back/close step (such as a `TwoPaneLayout` entering detail in switch or narrow mode).
 * The host owns browser history, Escape handling, and the unified unsaved-changes guard so layouts never compete with
 * dialogs, router history, or each other.
 */
export interface PanelBackHandlerRegistration {
  /** Whether closing this overlay/detail should push a browser history entry so browser Back invokes `onBack`. */
  readonly pushHistory?: boolean;
  /** Invoked by the host on browser Back or Escape (only after the host's unified unsaved-changes guard passes). */
  readonly onBack: () => void;
}

export interface PanelBackControllerOptions {
  /** Whether this host is currently shown to the reader; kept-alive hidden pages ignore global Back and Escape. */
  active: () => boolean;
  /** Whether this host owns browser history (full page and preview: true; beside conversation or custom frame: false). */
  allowHistory: () => boolean;
  /** Whether the hosted panel currently has unsaved edits. */
  isDirty: () => boolean;
  /** Unified host confirmation for leaving unsaved edits; resolves true when clean or confirmed. */
  confirmLeaveUnsaved: () => Promise<boolean>;
}

export interface PanelBackController {
  register(registration: PanelBackHandlerRegistration): () => void;
  /** Refreshes the stored URL/state snapshot after the host replaces the address (e.g. deep-link `?state=` sync). */
  syncHistorySnapshot(): void;
  dispose(): void;
}

const BACK_MARKER_KEY = "__ontomatoPanelBack";
let nextBackToken = 0;

interface StackEntry {
  readonly token: string | null;
  readonly onBack: () => void;
  pushedUrl: string;
  pushedState: Record<string, unknown>;
  poppedByHistory: boolean;
}

const OVERLAY_SELECTOR = [
  "dialog[open]",
  '[aria-modal="true"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  ".el-overlay",
  ".el-dialog",
  ".el-drawer",
  ".el-dropdown__popper",
  ".el-select__popper",
  ".el-popover",
  ".el-picker__popper",
  ".el-cascader__dropdown",
  ".el-autocomplete__popper",
  ".agent-menu",
  '[aria-haspopup][aria-expanded="true"]',
  '[role="combobox"][aria-expanded="true"]',
].join(", ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentHistoryToken(): string | null {
  if (typeof window === "undefined") return null;
  const state = window.history.state;
  return isRecord(state) && typeof state[BACK_MARKER_KEY] === "string" ? state[BACK_MARKER_KEY] : null;
}

function withoutHistoryMarker(state: unknown): Record<string, unknown> | null {
  if (!isRecord(state)) return null;
  if (!(BACK_MARKER_KEY in state)) return state;
  const { [BACK_MARKER_KEY]: _removed, ...rest } = state;
  return rest;
}

function isElementVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  let current: Element | null = element;
  while (current && current !== element.ownerDocument.documentElement) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    if (current instanceof HTMLElement) {
      if (current.style.display === "none" || current.style.visibility === "hidden") return false;
    }
    const view = current.ownerDocument.defaultView;
    if (view) {
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    current = current.parentElement;
  }
  return true;
}

/** Whether any modal dialog, drawer, menu, dropdown, or popover is currently visible and should receive Escape first. */
export function hasOpenOverlay(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  for (const element of doc.querySelectorAll(OVERLAY_SELECTOR)) {
    if (isElementVisible(element)) return true;
  }
  return false;
}

/**
 * Maintains a LIFO stack of back handlers for one panel host, coordinating browser history push/pop, global Escape
 * priority (yielding to open dialogs/drawers/dropdowns), and the host's unified unsaved-changes guard.
 */
export function createPanelBackController(options: PanelBackControllerOptions): PanelBackController {
  const stack: StackEntry[] = [];
  let handlingBack = false;
  let disposed = false;

  function removeEntry(entry: StackEntry): boolean {
    const index = stack.lastIndexOf(entry);
    if (index < 0) return false;
    stack.splice(index, 1);
    return true;
  }

  function clearHistoryMarker(token: string) {
    if (typeof window === "undefined" || currentHistoryToken() !== token) return;
    window.history.replaceState(withoutHistoryMarker(window.history.state), "", window.location.href);
  }

  function topHistoryEntry(): StackEntry | null {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]!.token !== null) return stack[index]!;
    }
    return null;
  }

  function register(registration: PanelBackHandlerRegistration): () => void {
    if (disposed) return () => {};
    let token: string | null = null;
    let pushedUrl = "";
    let pushedState: Record<string, unknown> = {};
    if (registration.pushHistory && options.allowHistory() && typeof window !== "undefined") {
      token = `panel-back-${++nextBackToken}`;
      pushedUrl = window.location.href;
      pushedState = { ...(isRecord(window.history.state) ? window.history.state : {}), [BACK_MARKER_KEY]: token };
      window.history.pushState(pushedState, "", pushedUrl);
    }
    const entry: StackEntry = {
      token,
      onBack: registration.onBack,
      pushedUrl,
      pushedState,
      poppedByHistory: false,
    };
    stack.push(entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      removeEntry(entry);
      if (entry.token !== null && !entry.poppedByHistory) clearHistoryMarker(entry.token);
    };
  }

  function syncHistorySnapshot() {
    if (disposed || handlingBack || !options.active() || typeof window === "undefined") return;
    const entry = topHistoryEntry();
    if (!entry || entry.token === null) return;
    const nextUrl = window.location.href;
    const nextState = {
      ...(isRecord(window.history.state) ? window.history.state : {}),
      [BACK_MARKER_KEY]: entry.token,
    };
    entry.pushedUrl = nextUrl;
    entry.pushedState = nextState;
    // Vue Router's `router.replace` replaces `history.state` with its own object; restore the back marker in place so
    // later browser Back / Cancel steps keep the updated URL and stay paired with this history entry.
    if (currentHistoryToken() !== entry.token) {
      window.history.replaceState(nextState, "", nextUrl);
    }
  }

  function onPopState(event: PopStateEvent) {
    if (disposed || !options.active() || handlingBack) return;
    const entry = topHistoryEntry();
    if (!entry || entry.token === null || currentHistoryToken() === entry.token) return;
    if (!options.isDirty()) {
      entry.poppedByHistory = true;
      removeEntry(entry);
      entry.onBack();
      return;
    }
    // Stop Vue Router from committing the underlying list URL while the reader decides whether to discard edits.
    event.stopImmediatePropagation();
    handlingBack = true;
    void (async () => {
      try {
        const allowed = await options.confirmLeaveUnsaved();
        if (disposed) return;
        if (allowed) {
          entry.poppedByHistory = true;
          removeEntry(entry);
          entry.onBack();
          return;
        }
        if (stack.includes(entry) && typeof window !== "undefined") {
          window.history.pushState(entry.pushedState, "", entry.pushedUrl);
        }
      } finally {
        handlingBack = false;
      }
    })();
  }

  function onKeydown(event: KeyboardEvent) {
    if (
      disposed ||
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !options.active() ||
      handlingBack ||
      stack.length === 0 ||
      hasOpenOverlay()
    ) {
      return;
    }
    const entry = stack[stack.length - 1]!;
    event.preventDefault();
    const invoke = () => {
      if (!removeEntry(entry)) return;
      if (entry.token !== null) clearHistoryMarker(entry.token);
      entry.onBack();
    };
    if (!options.isDirty()) {
      invoke();
      return;
    }
    handlingBack = true;
    void (async () => {
      try {
        const allowed = await options.confirmLeaveUnsaved();
        if (!disposed && allowed) invoke();
      } finally {
        handlingBack = false;
      }
    })();
  }

  if (typeof window !== "undefined") {
    // Capture phase ensures dirty popstate is intercepted before Vue Router commits the popped URL.
    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("keydown", onKeydown);
  }

  return {
    register,
    syncHistorySnapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      stack.length = 0;
      if (typeof window !== "undefined") {
        window.removeEventListener("popstate", onPopState, true);
        window.removeEventListener("keydown", onKeydown);
      }
    },
  };
}
