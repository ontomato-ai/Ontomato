/**
 * Registration for a panel-local back/close step (such as a `TwoPaneLayout` entering detail in switch or narrow mode).
 * The host owns browser history, Escape handling, and the unified unsaved-changes guard so layouts never compete with
 * dialogs, router history, or each other.
 */
export interface PanelBackHandlerRegistration {
  /** Whether closing this overlay/detail should push a browser history entry so browser Back invokes `onBack`. */
  readonly pushHistory?: boolean;
  /**
   * Optional layer-specific dirty check (for example a scoped sub-editor that only discards specific forms on close).
   * When omitted, the host falls back to the whole panel's `isDirty()`.
   */
  readonly isDirty?: () => boolean;
  /** Invoked by the host on browser Back or Escape (only after the host's unified unsaved-changes guard passes). */
  readonly onBack: () => void;
}

export interface PlatformBackHistoryContext {
  /**
   * Whether the panel runs beside a conversation (its address rides in the host route's `?page=` query).
   * When true, only a previous history entry on the same host route carrying a non-empty `page` query parameter
   * counts as an in-platform previous page — otherwise stepping back would close or leave the conversation.
   */
  beside?: boolean;
  /** History state object to inspect; defaults to `window.history.state`. */
  historyState?: unknown;
}

export interface PanelBackControllerOptions {
  /** Whether this host is currently shown to the reader; kept-alive hidden pages ignore global Back and Escape. */
  active: () => boolean;
  /** Whether this host owns browser history (full page and preview: true; beside conversation or custom frame: false). */
  allowHistory: () => boolean;
  /** Whether this host is mounted beside a conversation (its address rides in the host route's `?page=` query). */
  beside?: () => boolean;
  /** Whether the hosted panel currently has unsaved edits. */
  isDirty: () => boolean;
  /** Unified host confirmation for leaving unsaved edits; resolves true when clean or confirmed. */
  confirmLeaveUnsaved: () => Promise<boolean>;
  /**
   * Whether `navigateBack` must call `confirmLeaveUnsaved` itself because no enclosing shell router guard intercepts
   * the navigation (for example, a standalone `PanelHost` outside `PlatformShellLayout`).
   */
  guardNavigationBack?: () => boolean;
  /** Steps one entry back in browser history when `hasPlatformPreviousPage()` is true; defaults to `window.history.back()`. */
  goHistoryBack?: () => void;
  /** The host surface Escape is scoped to; outside interactions keep their own Escape behavior. */
  scopeElement?: () => HTMLElement | null;
}

export interface PanelBackController {
  register(registration: PanelBackHandlerRegistration): () => void;
  /**
   * Leaves the current panel/detail page by stepping back one browser history entry when an in-platform previous page
   * exists, otherwise navigating to `fallback`.
   */
  navigateBack(fallback: string, navigate: (address: string) => Promise<void>): Promise<void>;
  /** Refreshes the stored URL/state snapshot after the host replaces the address (e.g. deep-link query sync). */
  syncHistorySnapshot(): void;
  dispose(): void;
}

const BACK_MARKER_KEY = "__ontomatoPanelBack";
let nextBackToken = 0;

type PopStateHandler = (event: PopStateEvent) => boolean;
const popStateHandlers = new Set<PopStateHandler>();
let popStateListenerInstalled = false;

function dispatchPopState(event: PopStateEvent) {
  for (const handler of [...popStateHandlers].reverse()) {
    if (handler(event)) return;
  }
}

/**
 * Installs the shared window `popstate` dispatcher. Calling this before `createWebHashHistory()` / `createWebHistory()`
 * ensures panel-local back guards intercept dirty browser Back before Vue Router commits the underlying address (and
 * before inter-listener microtask checkpoints flush watchers that would otherwise overwrite the popped history entry).
 */
export function installPanelBackPopStateListener(): void {
  if (popStateListenerInstalled || typeof window === "undefined") return;
  popStateListenerInstalled = true;
  window.addEventListener("popstate", dispatchPopState, true);
}

installPanelBackPopStateListener();

function routePathOf(url: string): string {
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    if (parsed.hash.startsWith("#/")) {
      const hashPath = parsed.hash.slice(1);
      const queryIndex = hashPath.indexOf("?");
      return queryIndex >= 0 ? hashPath.slice(0, queryIndex) : hashPath;
    }
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

interface StackEntry {
  readonly token: string | null;
  readonly isDirty?: () => boolean;
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

function isSiteRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function splitPathAndQuery(address: string): { path: string; search: string } {
  const hashIndex = address.indexOf("#");
  const withoutHash = hashIndex >= 0 ? address.slice(0, hashIndex) : address;
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex < 0) return { path: withoutHash, search: "" };
  return { path: withoutHash.slice(0, queryIndex), search: withoutHash.slice(queryIndex + 1) };
}

/**
 * Single rule for whether browser history holds a previous page produced by platform navigation.
 *
 * Vue Router writes `{ back, current, forward, position, replaced }` into `history.state`:
 * - Direct URL entry, new tab, or external link leaves `state.back === null` (or no router state at all).
 * - In-platform `router.push` records the previous site-relative route address in `state.back`, and `router.replace`
 *   (such as deep-link state sync) preserves `state.back`.
 * - Beside a conversation (`beside: true`), the panel rides in the conversation route's `?page=` query parameter, so
 *   only a previous entry on the same host route carrying a non-empty `page` query parameter counts; otherwise the
 *   panel falls back to its declared catalog address instead of closing or leaving the conversation.
 */
export function hasPlatformPreviousPage(context: PlatformBackHistoryContext = {}): boolean {
  const state = context.historyState !== undefined
    ? context.historyState
    : (typeof window !== "undefined" ? window.history.state : null);
  if (!isRecord(state) || !isSiteRelativePath(state.back)) return false;
  if (!context.beside) return true;
  if (!isSiteRelativePath(state.current)) return false;
  const current = splitPathAndQuery(state.current);
  const back = splitPathAndQuery(state.back);
  if (back.path !== current.path) return false;
  const backPage = new URLSearchParams(back.search).get("page");
  return typeof backPage === "string" && backPage.trim().length > 0;
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
      ...(registration.isDirty ? { isDirty: registration.isDirty } : {}),
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
    if (routePathOf(nextUrl) !== routePathOf(entry.pushedUrl)) return;
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

  function onPopState(event: PopStateEvent): boolean {
    if (disposed || !options.active()) return false;
    const entry = topHistoryEntry();
    if (!entry || entry.token === null) return false;
    const currentUrl = typeof window === "undefined" ? "" : window.location.href;
    if (routePathOf(currentUrl) !== routePathOf(entry.pushedUrl)) return false;
    if (handlingBack) {
      event.stopImmediatePropagation();
      return true;
    }
    if (currentHistoryToken() === entry.token) return false;
    const entryDirty = entry.isDirty ? entry.isDirty() : options.isDirty();
    if (!entryDirty) {
      entry.poppedByHistory = true;
      removeEntry(entry);
      entry.onBack();
      return true;
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
    return true;
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
    const target = event.target;
    const candidate = target instanceof Node && target !== document && target !== document.body && target !== document.documentElement
      ? target
      : typeof document !== "undefined"
        ? document.activeElement
        : null;
    const scope = options.scopeElement?.();
    if (
      scope &&
      candidate instanceof Node &&
      candidate !== document &&
      candidate !== document.body &&
      candidate !== document.documentElement &&
      !scope.contains(candidate)
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
    const entryDirty = entry.isDirty ? entry.isDirty() : options.isDirty();
    if (!entryDirty) {
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

  async function navigateBack(fallback: string, navigate: (address: string) => Promise<void>): Promise<void> {
    if (disposed || !options.active()) return;
    if (options.guardNavigationBack?.() && options.isDirty()) {
      const allowed = await options.confirmLeaveUnsaved();
      if (disposed || !allowed) return;
    }
    const beside = options.beside?.() ?? false;
    const canUseHistory = options.allowHistory() || beside;
    if (canUseHistory && hasPlatformPreviousPage({ beside })) {
      if (options.goHistoryBack) options.goHistoryBack();
      else if (typeof window !== "undefined") window.history.back();
      return;
    }
    await navigate(fallback);
  }

  if (typeof window !== "undefined") {
    installPanelBackPopStateListener();
    popStateHandlers.add(onPopState);
    window.addEventListener("keydown", onKeydown);
  }

  return {
    register,
    navigateBack,
    syncHistorySnapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      stack.length = 0;
      popStateHandlers.delete(onPopState);
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", onKeydown);
      }
    },
  };
}
