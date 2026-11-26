import { computed, nextTick, shallowRef, watch } from "vue";
import type {
  BlockedUnsavedForm,
  DisplayLoad,
  DisplayPageAddressInput,
  DisplaySnapshot,
  FormFillOutcome,
  FormFillRequestInput,
  ObservedPageTarget,
  PageActionOutcome,
  PageActionRequestInput,
  PendingPageActionConfirmation,
  PresentationFrame,
  PresentationReceipt,
} from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { randomId } from "@ontomato/contracts/random-id";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-context";
import { panelStateValueSchema, type PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { presentationAppliesAddress } from "@ontomato/contracts/panel-host";
import type { PanelCompletedOperation, PanelOperationAffected } from "@ontomato/contracts/panel-operations";
import type { ApplicationOpenResponse } from "@ontomato/contracts/product-panels";
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
  /** Consumes the permission result belonging to this particular opening. */
  takeOpenedEntry?: () => ApplicationOpenResponse | undefined;
}

export type DisplayTarget = { kind: "artifact"; open: OpenArtifact } | ({ kind: "page" } & DisplayPage);

/** Whether a reader's navigation adds a step to the browser's history or replaces the current one. */
export type DisplayHistory = "push" | "replace";

/** Result of checking whether the initiating reader is admitted to open a target page address. */
export type DisplayPageAdmissionResult =
  | { ok: true; openedEntry?: ApplicationOpenResponse }
  | { ok: false; reason: "forbidden" | "not_found" | "unsupported_target" | "outside_embedded_host"; error?: { code: string; message: string } };

/** Live state patch handed to a newly opened panel instance (covering all declared public state fields). */
export interface DisplayStateUpdate {
  readonly seq: number;
  readonly instance: string;
  readonly patch: Readonly<Record<string, RuntimeJsonValue>>;
}

/** In-place controls exposed by a currently mounted panel page to its display controller. */
export interface DisplayPageController {
  /** Validates a public state patch against the currently mounted page before any URL or state mutation. */
  validateState?(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  /** Returns the dirty forms whose bound inputs would be changed by the proposed address/state. */
  blockedForms?(next: { address: string; state?: Readonly<Record<string, RuntimeJsonValue>> }): readonly BlockedUnsavedForm[];
  /** Returns true when navigation changes inputs bound to a dirty form. */
  blocksNavigation?(next: { address: string; state?: Readonly<Record<string, RuntimeJsonValue>> }): boolean;
  /** Guards a human same-page navigation before the URL moves, settling affected dirty forms on confirm. */
  guardNavigation?(next: { address: string; state?: Readonly<Record<string, RuntimeJsonValue>> }): Promise<boolean>;
  /** Checks whether an agent same-page presentation would affect any dirty form (after in-flight auto-saves settle). */
  guardAgentPresentation?(
    next: { address: string; state?: Readonly<Record<string, RuntimeJsonValue>> },
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly blockedForms: readonly BlockedUnsavedForm[] }>;
  /** Applies deep-link overrides before a new address reaches a mounted instance with unsaved edits. */
  presentationAddress?(address: string, patch: Readonly<Record<string, RuntimeJsonValue>>): string;
  fillForm?(request: FormFillRequestInput): Promise<FormFillOutcome>;
  executeAction?(request: PageActionRequestInput): Promise<PageActionOutcome>;
  /** Live binding metadata (mount/panel/member/entry instance IDs, checked keys, dashboard board/card IDs) for display snapshots. */
  snapshotMeta?(): {
    readonly mountId?: string;
    readonly panelInstanceId?: string;
    readonly memberInstances?: Readonly<Record<string, string>>;
    readonly entryInstances?: Readonly<Record<string, string>>;
    readonly checkedKeys?: Readonly<Record<string, readonly string[]>>;
    readonly dashboardId?: string;
    readonly cardId?: string;
  };
  /** True while the page route, panel host, or declared members are still loading asynchronously. */
  isLoading?(): boolean;
}

/** Pending conversation confirmation bound to a specific live session and mounted page instance. */
export interface BoundPageActionConfirmation {
  readonly sessionId: string;
  readonly pageInstance: string;
  readonly pageInstanceId: string;
  readonly confirmation: PendingPageActionConfirmation;
}

export interface ConversationDisplayHost {
  /** The host's page declarations: which pages sit beside the conversation. */
  features: () => readonly ShellFeatureDeclaration[];
  /** The page an address opens here (a link, the address bar); null when it is none of this host's. */
  resolve?: (address: string) => DisplayPage | null;
  /** Optional live admission check run before opening a new page via `present`. */
  admit?: (address: string) => Promise<DisplayPageAdmissionResult>;
  /** An embedded display keeps its page in place when a run presents an artifact. */
  embedded?: boolean;
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
  /** Maximum milliseconds `fill_form`/`page_action` wait for a navigating or loading page/form/action to become ready (default 5000). */
  readinessTimeoutMs?: number;
}

interface Shown {
  target: DisplayTarget | null;
  view: DisplayView;
  /** The reader navigated here, so the address carries it; an artifact is never in the address. */
  restorable: boolean;
}

const READY: DisplayLoad = { status: "ready" };

/**
 * What changed for a shown page to read again (design "long connections" 4, shared components U10). A `target` is the
 * object an agent changed in this conversation; null asks for everything shown — because what changed while nothing was
 * listening is not known (the page was just opened, or the view's stream is ready again), or because the owner's result
 * names no single object (a batch). `affected` is the owner's own account of the objects and types the write touched,
 * passed through as the owner gave it; the host reads it to refresh what depends on them, such as a menu's counts.
 */
export type DisplayObjectChange = {
  target: PanelObjectIdentity | null;
  affected?: PanelOperationAffected;
  operation?: PanelCompletedOperation;
};

/**
 * The signal a shown page reads its objects again by: each change counts up `seq`. The same signal reaches the page
 * wherever it sits: beside the conversation, over it, or full.
 */
export type DisplayObjectRefresh = { seq: number } & DisplayObjectChange;

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
  /** The current page placement reported by the shown page instance; cleared on instance change, close, or redirect. */
  const reportedSkill = shallowRef<PageSkillContext | null>(null);
  const load = shallowRef<DisplayLoad>(READY);
  const objectRefresh = shallowRef<DisplayObjectRefresh | null>(null);
  const liveState = shallowRef<DisplayStateUpdate | null>(null);
  const controllers = new Map<string, DisplayPageController>();
  const controllersRevision = shallowRef(0);
  const pendingStates = new Map<string, Record<string, RuntimeJsonValue>>();
  const readinessTimeoutMs = host.readinessTimeoutMs ?? 5000;
  const pageInstanceId = shallowRef<string | null>(host.initial ? randomId() : null);
  let controllerMountedForCurrentPage = false;
  const inFlightPageActions = new Set<Promise<unknown>>();
  function refreshObjects(change: DisplayObjectChange) {
    objectRefresh.value = { seq: (objectRefresh.value?.seq ?? 0) + 1, ...change };
  }
  /** Whether the shown page instance reports unsaved changes via `display-dirty`; native pages answer through `host.leave`. */
  const unsaved = shallowRef(false);
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
  const pageSkill = computed(() => (page.value ? reportedSkill.value : null));

  const pendingConfirmations = new Map<string, BoundPageActionConfirmation>();

  function cancelConfirmationsForPage(instance: string, instanceId?: string | null) {
    for (const [questionId, bound] of pendingConfirmations.entries()) {
      if (bound.pageInstance === instance && (instanceId === undefined || bound.pageInstanceId === instanceId)) {
        pendingConfirmations.delete(questionId);
        void bound.confirmation.cancel({
          code: "FORM_CONFIRMATION_STALE",
          message: "The page closed, remounted, or navigated away before confirmation.",
        }).catch(() => undefined);
      }
    }
  }

  function commit(next: Shown) {
    const current = shown.value.target;
    const sameInstance =
      current?.kind === "page" && next.target?.kind === "page" && current.instance === next.target.instance;
    if (!sameInstance) {
      const previousPageInstanceId = pageInstanceId.value;
      reported.value = null;
      reportedSkill.value = null;
      load.value = READY;
      unsaved.value = false;
      pageInstanceId.value = next.target?.kind === "page" ? randomId() : null;
      controllerMountedForCurrentPage = false;
      if (liveState.value && (next.target?.kind !== "page" || liveState.value.instance !== next.target.instance)) {
        liveState.value = null;
      }
      for (const instance of pendingStates.keys()) {
        if (next.target?.kind !== "page" || instance !== next.target.instance) pendingStates.delete(instance);
      }
      if (current?.kind === "page") {
        cancelConfirmationsForPage(current.instance, previousPageInstanceId);
      }
    }
    shown.value = next;
    // Embedded panels refresh through their host when shown. Beside a conversation the display initiates the read.
    if (!host.embedded && !sameInstance && next.target?.kind === "page") refreshObjects({ target: null });
  }

  /** Whether going to `next` leaves the shown page instance while it holds unsaved changes. */
  function dropsUnsaved(next: DisplayTarget | null): boolean {
    const current = page.value;
    if (!current) return false;
    if (next?.kind === "page" && next.instance === current.instance) {
      return Boolean(controllers.get(current.instance)?.blocksNavigation?.({ address: next.address }));
    }
    return unsaved.value || host.leave.leaves(next?.kind === "page" ? next.address : null);
  }

  /** Leaving the shown page instance with unsaved changes asks the reader first; same-instance changes guard per form. */
  async function mayLeave(next: DisplayTarget | null): Promise<boolean> {
    const current = page.value;
    if (current && next?.kind === "page" && next.instance === current.instance) {
      const controller = controllers.get(current.instance);
      if (controller?.guardNavigation) {
        return controller.guardNavigation({ address: next.address });
      }
    }
    return !dropsUnsaved(next) || host.leave.confirm();
  }

  /** One observation of what is shown, for a presentation result. */
  function snapshot(): DisplaySnapshot {
    const observedAt = new Date().toISOString();
    const target = shown.value.target;
    if (!target || (host.embedded && target.kind === "page" && !controllers.has(target.instance))) {
      return { known: true, observedAt, target: null };
    }
    return selected(observedAt);
  }
  function effectivePageInstanceId(instance?: string): string | null {
    const base = pageInstanceId.value;
    if (!base) return null;
    const targetInstance = instance ?? (shown.value.target?.kind === "page" ? shown.value.target.instance : undefined);
    const mountId = targetInstance ? controllers.get(targetInstance)?.snapshotMeta?.()?.mountId : undefined;
    return mountId ? `${base}:${mountId}` : base;
  }

  function selected(observedAt = new Date().toISOString()): Selected {
    const current = shown.value.target!;
    const full = current.kind === "page" && (shown.value.view === "full" || !feature.value?.withConversation);
    const where = full ? "full-page" : (placement ? placement() : "side");
    if (current.kind === "artifact") {
      const { runId, path } = current.open.artifact;
      return { known: true, observedAt, placement: where, target: { kind: "artifact", runId, path, title: current.open.title }, load: load.value };
    }
    return {
      known: true, observedAt, placement: where, target: pageSnapshot(pageContext.value!), load: load.value,
    };
  }

  function pageSnapshot(context: PageContext): ObservedPageTarget {
    const instance = page.value!.instance;
    const meta = controllers.get(instance)?.snapshotMeta?.();
    const currentPageInstanceId = effectivePageInstanceId(instance);
    const panelInstanceId = meta?.panelInstanceId;
    const memberInstances = meta?.memberInstances && Object.keys(meta.memberInstances).length
      ? { ...meta.memberInstances }
      : undefined;
    const entryInstances = meta?.entryInstances && Object.keys(meta.entryInstances).length
      ? { ...meta.entryInstances }
      : undefined;
    const checkedKeys = meta?.checkedKeys && Object.keys(meta.checkedKeys).length
      ? Object.fromEntries(Object.entries(meta.checkedKeys).map(([k, v]) => [k, [...v]]))
      : undefined;
    const dashboardId = meta?.dashboardId;
    const cardId = meta?.cardId;
    return {
      kind: "page",
      ...context,
      ...(currentPageInstanceId ? { pageInstanceId: currentPageInstanceId } : {}),
      ...(panelInstanceId ? { panelInstanceId } : {}),
      ...(memberInstances ? { memberInstances } : {}),
      ...(entryInstances ? { entryInstances } : {}),
      ...(checkedKeys ? { checkedKeys } : {}),
      ...(dashboardId ? { dashboardId } : {}),
      ...(cardId ? { cardId } : {}),
    };
  }

  function notOpened(
    reason: NotOpenedReason,
    error?: { code: string; message: string },
    blockedForms?: readonly BlockedUnsavedForm[],
  ): DisplayPresentationResult {
    return {
      status: "not_opened",
      reason,
      ...(blockedForms?.length ? { blockedForms: [...blockedForms] } : {}),
      current: snapshot(),
      ...(error ? { error } : {}),
    };
  }

  function describeBlockedForm(form: BlockedUnsavedForm): string {
    const location = form.memberPath?.length ? [...form.memberPath, form.member].join(".") : form.member;
    if (form.target?.kind === "object") {
      return `${location} (${form.target.objectType} ${form.target.primaryKey})`;
    }
    if (form.target?.kind === "draft") {
      return form.target.id ? `${location} (draft ${form.target.id})` : `${location} (draft)`;
    }
    return location;
  }

  function blockedUnsaved(blockedForms?: readonly BlockedUnsavedForm[]): DisplayPresentationResult {
    const message = blockedForms?.length
      ? `The current page has unsaved changes in ${blockedForms.map(describeBlockedForm).join(", ")}. Ask the user to save or discard them before changing targets.`
      : "The current page has unsaved changes. Ask the user to save or discard them before navigating away.";
    return notOpened(
      "blocked_unsaved",
      { code: "UNSAVED_CHANGES", message },
      blockedForms,
    );
  }

  function validateStatePatch(state: Record<string, RuntimeJsonValue>): { ok: true } | { ok: false; error: { code: string; message: string } } {
    for (const [name, value] of Object.entries(state)) {
      const parsed = panelStateValueSchema.safeParse(value);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_state", message: `Invalid value for state '${name}': ${parsed.error.issues[0]?.message ?? "invalid type"}` } };
      }
    }
    return { ok: true };
  }

  async function waitForLoadSettle(targetPage: DisplayTarget, timeoutMs = 5000): Promise<void> {
    await nextTick();
    if (load.value.status !== "loading") return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const stop = watch(
        () => [load.value.status, shown.value.target] as const,
        ([status, currentTarget]) => {
          if (status !== "loading" || currentTarget !== targetPage) finish();
        },
        { immediate: true },
      );
    });
    await nextTick();
  }

  function waitForSignalOrInterval(maxMs: number): Promise<void> {
    if (maxMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(finish, Math.min(50, maxMs));
      const stop = watch(
        () => [load.value.status, controllersRevision.value, shown.value.target, pageInstanceId.value] as const,
        () => finish(),
      );
    });
  }

  async function waitForPageController(
    targetInstance: string,
    startPageInstanceId: string | null,
    deadline: number,
    verifyActive?: () => "view_unavailable" | "not_viewing_session" | null,
  ): Promise<
    | { readonly ok: true; readonly controller: DisplayPageController | null }
    | { readonly ok: false; readonly kind: "inactive"; readonly reason: "view_unavailable" | "not_viewing_session" }
    | { readonly ok: false; readonly kind: "stale" }
    | { readonly ok: false; readonly kind: "load_error"; readonly error?: { code: string; message: string } }
  > {
    await nextTick();
    while (true) {
      const inactive = verifyActive?.() ?? null;
      if (inactive) return { ok: false, kind: "inactive", reason: inactive };
      const currentTarget = shown.value.target;
      if (
        !currentTarget
        || currentTarget.kind !== "page"
        || currentTarget.instance !== targetInstance
        || effectivePageInstanceId(targetInstance) !== startPageInstanceId
      ) {
        return { ok: false, kind: "stale" };
      }
      if (load.value.status === "error") {
        return { ok: false, kind: "load_error", ...(load.value.error ? { error: load.value.error } : {}) };
      }
      const controller = controllers.get(targetInstance) ?? null;
      if (controller && load.value.status !== "loading" && !controller.isLoading?.()) {
        return { ok: true, controller };
      }
      // A non-loading page with no registered controller is a static/unsupported page; do not stall.
      if (!controller && load.value.status === "ready") {
        return { ok: true, controller: null };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { ok: true, controller };
      }
      await waitForSignalOrInterval(remaining);
    }
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

  async function actionReceipt(
    outcome: PageActionOutcome,
    frame: PresentationFrame,
    instance: string,
    startPageInstanceId: string | null,
    operation?: string,
  ): Promise<DisplayPresentationResult> {
    const stillSamePage =
      shown.value.target?.kind === "page"
      && shown.value.target.instance === instance
      && effectivePageInstanceId(instance) === startPageInstanceId;
    if (outcome.ok && outcome.kind === "awaiting_confirmation") {
      if (!stillSamePage) {
        await outcome.confirmation.cancel({
          code: "FORM_CONFIRMATION_STALE",
          message: "The page closed, remounted, or navigated away while preparing confirmation.",
        }).catch(() => undefined);
        return {
          status: "not_executed",
          reason: "stale",
          operation: outcome.operation,
          intentId: outcome.intentId,
          current: snapshot(),
          error: {
            code: "STALE",
            message: "The page closed, remounted, or navigated away while preparing confirmation.",
          },
        };
      }
      pendingConfirmations.set(outcome.questionId, {
        sessionId: frame.sessionId,
        pageInstance: instance,
        pageInstanceId: startPageInstanceId ?? "",
        confirmation: outcome.confirmation,
      });
      await nextTick();
      await nextTick();
      return {
        status: "awaiting_confirmation",
        reason: "confirmation_required",
        operation: outcome.operation,
        intentId: outcome.intentId,
        questionId: outcome.questionId,
        label: outcome.label,
        current: snapshot(),
      };
    }
    await nextTick();
    await nextTick();
    if (outcome.ok && outcome.kind === "executed") {
      return {
        status: "executed",
        reason: "action_completed",
        operation: outcome.operation,
        ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
        ...(outcome.outcome !== undefined ? { outcome: outcome.outcome } : {}),
        current: snapshot(),
      };
    }
    if ("kind" in outcome && outcome.kind === "partially_executed") {
      return {
        status: "partially_executed",
        reason: "partial_completion",
        operation: outcome.operation,
        ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
        ...(outcome.savedFields?.length ? { savedFields: [...outcome.savedFields] } : {}),
        outcome: outcome.outcome,
        current: snapshot(),
        error: { code: outcome.code, message: outcome.message },
      };
    }
    if ("kind" in outcome && outcome.kind === "unknown") {
      return {
        status: "unknown",
        reason: "outcome_unknown",
        operation: outcome.operation,
        ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
        ...(outcome.outcome !== undefined ? { outcome: outcome.outcome } : {}),
        current: snapshot(),
        error: {
          code: "ACTION_OUTCOME_UNKNOWN",
          message: outcome.message ?? "Operation was dispatched, but its outcome is unknown. Check the intent status without retrying.",
        },
      };
    }
    return {
      status: "not_executed",
      reason: outcome.reason,
      ...((outcome.operation ?? operation) ? { operation: outcome.operation ?? operation } : {}),
      ...(outcome.intentId ? { intentId: outcome.intentId } : {}),
      current: snapshot(),
      ...(outcome.message || outcome.code
        ? { error: { code: outcome.code ?? outcome.reason.toUpperCase(), message: outcome.message ?? outcome.reason } }
        : {}),
    };
  }


  return {
    target,
    page,
    pageInstanceId: computed(() => effectivePageInstanceId()),
    feature,
    view: computed(() => shown.value.view),
    restorable: computed(() => shown.value.restorable),
    pageContext,
    pageSkill,
    isDirty: computed(() => unsaved.value),
    load: computed(() => load.value),
    /** What the shown page reads its objects again by; it keeps counting across pages. */
    objectRefresh: computed(() => objectRefresh.value),
    /** Initial live state patch (including non-deepLink declared public state) for a newly presented panel instance. */
    liveState: computed(() => liveState.value),
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
    skill(next: PageSkillContext | null) {
      reportedSkill.value = page.value ? next : null;
    },
    loaded(next: DisplayLoad) {
      load.value = next;
    },
    dirty(value: boolean) {
      unsaved.value = value;
    },
    /** A mounted panel page registers its in-place live state controller for `present`. */
    registerPageController(instance: string, controller: DisplayPageController): () => void {
      if (shown.value.target?.kind === "page" && shown.value.target.instance === instance) {
        if (controllerMountedForCurrentPage) {
          const previousId = pageInstanceId.value;
          pageInstanceId.value = randomId();
          cancelConfirmationsForPage(instance, previousId);
        }
        controllerMountedForCurrentPage = true;
      }
      controllers.set(instance, controller);
      controllersRevision.value += 1;
      const pending = pendingStates.get(instance);
      if (pending) {
        pendingStates.delete(instance);
        if (liveState.value?.instance === instance) liveState.value = null;
        try {
          controller.applyState(pending);
        } catch (error) {
          load.value = {
            status: "error",
            error: {
              code: "invalid_state",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
      return () => {
        if (controllers.get(instance) === controller) {
          controllers.delete(instance);
          controllersRevision.value += 1;
        }
      };
    },

    /** The outlet drawing the side reports where it sits; it takes the report back when it goes. */
    placed(probe: DisplayPlacementProbe): () => void {
      placement = probe;
      return () => {
        if (placement === probe) placement = null;
      };
    },

    snapshot,
    pageSnapshot,

    /** Removes and returns the live-bound page confirmation for a conversation question, if this page instance holds it. */
    takePendingActionConfirmation(questionId: string): BoundPageActionConfirmation | null {
      const found = pendingConfirmations.get(questionId) ?? null;
      if (found) pendingConfirmations.delete(questionId);
      return found;
    },

    /**
     * Resolves and removes the live-bound page confirmation for `questionId`, waiting for any in-flight
     * page write preparation on this tab to finish registering its confirmation closure when the SSE
     * confirmation question arrived before the preparation HTTP response returned.
     */
    async waitPendingActionConfirmation(questionId: string): Promise<BoundPageActionConfirmation | null> {
      const immediate = pendingConfirmations.get(questionId);
      if (immediate) {
        pendingConfirmations.delete(questionId);
        return immediate;
      }
      while (inFlightPageActions.size > 0) {
        const batch = [...inFlightPageActions];
        await Promise.allSettled(batch);
        const found = pendingConfirmations.get(questionId);
        if (found) {
          pendingConfirmations.delete(questionId);
          return found;
        }
        if ([...inFlightPageActions].every((promise) => batch.includes(promise))) break;
      }
      return null;
    },

    /**
     * An agent's request to show an artifact or navigate/update a page in place:
     * - Artifacts stay temporary and out of the address bar.
     * - Pages perform a real navigation written into the browser address (restored on reload) without changing the
     *   user's chosen side-by-side or full-page layout (opening side-by-side only when no page is currently open).
     * - Declared public state patches (including non-deepLink fields) apply in place without reloading or writing.
     * - Live fills use the mounted form controller, which checks for unsaved edits.
     * - Unauthorized entries are rejected before opening, returning the refusal reason in the receipt.
     */
    present(frame: PresentationFrame, verifyActive?: () => "view_unavailable" | "not_viewing_session" | null) {
      const run = inOrder(async (): Promise<DisplayPresentationResult> => {
        const inactive = verifyActive?.() ?? null;
        if (inactive) {
          const unknown = { known: false as const, reason: inactive };
          if (frame.target.kind === "observe") return { status: "observed", reason: inactive, current: unknown };
          if (frame.target.kind === "fill_form") return { status: "not_filled", reason: inactive, current: unknown };
          if (frame.target.kind === "page_action") return { status: "not_executed", reason: inactive, current: unknown };
          return { status: "not_opened", reason: inactive, current: unknown };
        }
        if (frame.target.kind === "observe") {
          await nextTick();
          return { status: "observed", reason: "current_display", current: snapshot() };
        }
        if (frame.target.kind === "page_action") {
          const currentTarget = shown.value.target;
          if (!currentTarget || currentTarget.kind !== "page") {
            return {
              status: "not_executed",
              reason: "no_page_shown",
              operation: frame.target.operation,
              current: snapshot(),
              error: { code: "NO_PAGE_SHOWN", message: "No page is currently open beside the conversation." },
            };
          }
          const startPageInstanceId = effectivePageInstanceId(currentTarget.instance);
          if (
            frame.target.expectedPageInstanceId !== undefined
            && frame.target.expectedPageInstanceId !== startPageInstanceId
          ) {
            return {
              status: "not_executed",
              reason: "stale",
              operation: frame.target.operation,
              current: snapshot(),
              error: {
                code: "STALE",
                message: "The displayed page changed or remounted since the last observation.",
              },
            };
          }
          const deadline = Date.now() + readinessTimeoutMs;
          const waited = await waitForPageController(currentTarget.instance, startPageInstanceId, deadline, verifyActive);
          if (!waited.ok) {
            if (waited.kind === "inactive") {
              return { status: "not_executed", reason: waited.reason, operation: frame.target.operation, current: { known: false, reason: waited.reason } };
            }
            if (waited.kind === "stale") {
              return {
                status: "not_executed",
                reason: "stale",
                operation: frame.target.operation,
                current: snapshot(),
                error: { code: "STALE", message: "The page closed, remounted, or navigated away while waiting for readiness." },
              };
            }
            return {
              status: "not_executed",
              reason: "action_not_ready",
              operation: frame.target.operation,
              current: snapshot(),
              error: waited.error ?? { code: "LOAD_ERROR", message: "The page failed to load." },
            };
          }
          const controller = waited.controller;
          if (!controller?.executeAction) {
            return {
              status: "not_executed",
              reason: "unsupported_page",
              operation: frame.target.operation,
              current: snapshot(),
              error: { code: "UNSUPPORTED_PAGE", message: "The currently displayed page does not expose a live action controller." },
            };
          }
          const actionRequest: PageActionRequestInput = {
            operation: frame.target.operation,
            ...(frame.target.memberPath === undefined ? {} : { memberPath: frame.target.memberPath }),
            ...(frame.target.rowKey === undefined ? {} : { rowKey: frame.target.rowKey }),
            ...(frame.target.input === undefined ? {} : { input: frame.target.input }),
            ...(frame.target.expectedPageInstanceId === undefined ? {} : { expectedPageInstanceId: frame.target.expectedPageInstanceId }),
            ...(frame.target.expectedPanelInstanceId === undefined ? {} : { expectedPanelInstanceId: frame.target.expectedPanelInstanceId }),
            ...(frame.target.expectedMemberInstanceId === undefined ? {} : { expectedMemberInstanceId: frame.target.expectedMemberInstanceId }),
            ...(frame.target.expectedEntryInstanceId === undefined ? {} : { expectedEntryInstanceId: frame.target.expectedEntryInstanceId }),
            ...(frame.target.expectedTarget === undefined ? {} : { expectedTarget: frame.target.expectedTarget }),
            ...(frame.target.expectedCheckedKeys === undefined ? {} : { expectedCheckedKeys: frame.target.expectedCheckedKeys }),
            ...(frame.target.expectedDashboardId === undefined ? {} : { expectedDashboardId: frame.target.expectedDashboardId }),
            ...(frame.target.expectedCardId === undefined ? {} : { expectedCardId: frame.target.expectedCardId }),
            agentRun: { sessionId: frame.sessionId, runId: frame.runId, toolCallId: frame.toolCallId },
          };
          let outcome = await controller.executeAction(actionRequest);
          while (
            !outcome.ok
            && (outcome.reason === "action_not_ready"
              || (outcome.reason === "action_not_found" && (load.value.status === "loading" || controller.isLoading?.())))
            && Date.now() < deadline
          ) {
            await waitForSignalOrInterval(deadline - Date.now());
            const retryInactive = verifyActive?.() ?? null;
            if (retryInactive) {
              return { status: "not_executed", reason: retryInactive, operation: frame.target.operation, current: { known: false, reason: retryInactive } };
            }
            const nowTarget = shown.value.target;
            if (
              !nowTarget
              || nowTarget.kind !== "page"
              || nowTarget.instance !== currentTarget.instance
              || effectivePageInstanceId(currentTarget.instance) !== startPageInstanceId
            ) {
              return {
                status: "not_executed",
                reason: "stale",
                operation: frame.target.operation,
                current: snapshot(),
                error: { code: "STALE", message: "The page closed, remounted, or navigated away while waiting for the action." },
              };
            }
            if (load.value.status === "error") {
              return {
                status: "not_executed",
                reason: "action_not_ready",
                operation: frame.target.operation,
                current: snapshot(),
                error: load.value.error ?? { code: "LOAD_ERROR", message: "The page failed to load." },
              };
            }
            outcome = await controller.executeAction(actionRequest);
          }
          return actionReceipt(outcome, frame, currentTarget.instance, startPageInstanceId, frame.target.operation);
        }

        if (frame.target.kind === "fill_form") {
          const currentTarget = shown.value.target;
          if (!currentTarget || currentTarget.kind !== "page") {
            return {
              status: "not_filled",
              reason: "no_page_shown",
              current: snapshot(),
              error: { code: "NO_PAGE_SHOWN", message: "No page is currently open beside the conversation." },
            };
          }
          const startPageInstanceId = effectivePageInstanceId(currentTarget.instance);
          if (
            frame.target.expectedPageInstanceId !== undefined
            && frame.target.expectedPageInstanceId !== startPageInstanceId
          ) {
            return {
              status: "not_filled",
              reason: "stale",
              ...(frame.target.member ? { member: frame.target.member } : {}),
              ...(frame.target.memberPath?.length ? { memberPath: [...frame.target.memberPath] } : {}),
              current: snapshot(),
              error: {
                code: "STALE",
                message: "The displayed page changed or remounted since the last observation.",
              },
            };
          }
          const deadline = Date.now() + readinessTimeoutMs;
          const waited = await waitForPageController(currentTarget.instance, startPageInstanceId, deadline, verifyActive);
          if (!waited.ok) {
            if (waited.kind === "inactive") {
              return { status: "not_filled", reason: waited.reason, current: { known: false, reason: waited.reason } };
            }
            if (waited.kind === "stale") {
              return {
                status: "not_filled",
                reason: "stale",
                current: snapshot(),
                error: { code: "STALE", message: "The page closed, remounted, or navigated away while waiting for readiness." },
              };
            }
            return {
              status: "not_filled",
              reason: "form_not_ready",
              current: snapshot(),
              error: waited.error ?? { code: "LOAD_ERROR", message: "The page failed to load." },
            };
          }
          const controller = waited.controller;
          if (!controller?.fillForm) {
            return {
              status: "not_filled",
              reason: "unsupported_page",
              current: snapshot(),
              error: { code: "UNSUPPORTED_PAGE", message: "The currently displayed page does not expose a live form controller." },
            };
          }
          const fillRequest: FormFillRequestInput = {
            ...(frame.target.member === undefined ? {} : { member: frame.target.member }),
            ...(frame.target.memberPath === undefined ? {} : { memberPath: frame.target.memberPath }),
            values: frame.target.values,
            agentRun: { sessionId: frame.sessionId, runId: frame.runId, toolCallId: frame.toolCallId },
            ...(frame.target.overwriteUnsaved ? { overwriteUnsaved: true } : {}),
            ...(frame.target.expectedPageInstanceId === undefined ? {} : { expectedPageInstanceId: frame.target.expectedPageInstanceId }),
            ...(frame.target.expectedPanelInstanceId === undefined ? {} : { expectedPanelInstanceId: frame.target.expectedPanelInstanceId }),
            ...(frame.target.expectedMemberInstanceId === undefined ? {} : { expectedMemberInstanceId: frame.target.expectedMemberInstanceId }),
            ...(frame.target.expectedFormInstanceId === undefined ? {} : { expectedFormInstanceId: frame.target.expectedFormInstanceId }),
            ...(frame.target.expectedTarget === undefined ? {} : { expectedTarget: frame.target.expectedTarget }),
            ...(frame.target.expectedDashboardId === undefined ? {} : { expectedDashboardId: frame.target.expectedDashboardId }),
            ...(frame.target.expectedCardId === undefined ? {} : { expectedCardId: frame.target.expectedCardId }),
          };
          let outcome = await controller.fillForm(fillRequest);
          while (
            !outcome.ok
            && (outcome.reason === "form_not_ready"
              || (outcome.reason === "form_not_found" && (load.value.status === "loading" || controller.isLoading?.())))
            && Date.now() < deadline
          ) {
            await waitForSignalOrInterval(deadline - Date.now());
            const retryInactive = verifyActive?.() ?? null;
            if (retryInactive) {
              return { status: "not_filled", reason: retryInactive, current: { known: false, reason: retryInactive } };
            }
            const nowTarget = shown.value.target;
            if (
              !nowTarget
              || nowTarget.kind !== "page"
              || nowTarget.instance !== currentTarget.instance
              || effectivePageInstanceId(currentTarget.instance) !== startPageInstanceId
            ) {
              return {
                status: "not_filled",
                reason: "stale",
                current: snapshot(),
                error: { code: "STALE", message: "The page closed, remounted, or navigated away while waiting for the form." },
              };
            }
            if (load.value.status === "error") {
              return {
                status: "not_filled",
                reason: "form_not_ready",
                current: snapshot(),
                error: load.value.error ?? { code: "LOAD_ERROR", message: "The page failed to load." },
              };
            }
            outcome = await controller.fillForm(fillRequest);
          }
          await nextTick();
          await nextTick();
          if (outcome.ok && outcome.write) {
            return actionReceipt(outcome.write, frame, currentTarget.instance, startPageInstanceId);
          }
          const stillSamePage =
            shown.value.target?.kind === "page"
            && shown.value.target.instance === currentTarget.instance
            && effectivePageInstanceId(currentTarget.instance) === startPageInstanceId;
          if (outcome.ok && stillSamePage) {
            const shownNow = selected();
            return {
              status: "filled",
              reason: "form_updated",
              member: outcome.member,
              ...(outcome.memberPath?.length ? { memberPath: [...outcome.memberPath] } : {}),
              filledFields: [...outcome.filledFields],
              ...(outcome.rejectedFields?.length ? { rejectedFields: [...outcome.rejectedFields] } : {}),
              current: shownNow,
            };
          }
          return {
            status: "not_filled",
            reason: outcome.ok ? "stale" : outcome.reason,
            ...(outcome.member ? { member: outcome.member } : {}),
            ...(outcome.memberPath?.length ? { memberPath: [...outcome.memberPath] } : {}),
            ...(outcome.rejectedFields?.length ? { rejectedFields: [...outcome.rejectedFields] } : {}),
            current: snapshot(),
            ...(!outcome.ok && outcome.message
              ? { error: { code: outcome.reason.toUpperCase(), message: outcome.message } }
              : outcome.ok
                ? { error: { code: "STALE", message: "The page closed, remounted, or navigated away while filling the form." } }
                : {}),
          };
        }
        const current = shown.value;
        if (frame.target.kind === "artifact") {
          if (host.embedded) return notOpened("outside_embedded_host");
          const { artifact } = frame.target;
          const next: DisplayTarget = {
            kind: "artifact",
            open: { key: `${artifact.runId}:${artifact.path}`, artifact, title: fileName(artifact.path) },
          };
          const same = current.target?.kind === "artifact" && current.target.open.key === next.open.key;
          if (!same) {
            if (dropsUnsaved(next)) return notOpened("blocked_unsaved");
            commit({ target: next, view: current.view, restorable: false });
            if (current.restorable) await write(null, shown.value.view, "replace");
          }
          await nextTick();
          const shownNow = selected();
          return shownNow.load.status === "error"
            ? { status: "opened", reason: "load_error", current: shownNow, ...(shownNow.load.error ? { error: shownNow.load.error } : {}) }
            : { status: "opened", reason: "target_selected", current: shownNow };
        }

        const { address: rawAddress, state: rawState } = frame.target;
        if (rawState !== undefined) {
          const valid = validateStatePatch(rawState);
          if (!valid.ok) return notOpened("unsupported_target", valid.error);
        }

        let resolved = host.resolve?.(rawAddress) ?? null;
        const currentPage = current.target?.kind === "page" ? current.target : null;
        const sameInstance =
          currentPage !== null && resolved !== null && currentPage.instance === resolved.instance;

        if (!sameInstance && host.admit) {
          const admission = await host.admit(rawAddress);
          if (!admission.ok) return notOpened(admission.reason, admission.error);
          if (resolved === null) resolved = host.resolve?.(rawAddress) ?? null;
          let openedEntry = admission.openedEntry;
          if (resolved && openedEntry) resolved = {
            ...resolved,
            takeOpenedEntry: () => {
              const entry = openedEntry;
              openedEntry = undefined;
              return entry;
            },
          };
        }
        if (!resolved) return notOpened("unsupported_target");

        const nextTarget: DisplayTarget = { kind: "page", ...resolved };
        if (!sameInstance && dropsUnsaved(nextTarget)) return blockedUnsaved();

        // Preserve the user's chosen side-by-side or full-page layout; open side-by-side when no page is open.
        const nextView: DisplayView = current.target?.kind === "page" ? current.view : "side";

        if (sameInstance && currentPage) {
          const controller = controllers.get(resolved.instance);
          const next = { address: resolved.address, state: rawState };
          const hasStatePatch = rawState !== undefined && Object.keys(rawState).length > 0;
          const basePathOf = (value: string) => value.split(/[?#]/, 1)[0]!;
          const sameBasePath = basePathOf(resolved.address) === basePathOf(currentPage.address);
          // Validate the live state patch BEFORE checking dirty forms or mutating the browser address so an invalid
          // state field or value type leaves the current URL and selection completely untouched.
          if (hasStatePatch && controller?.validateState && sameBasePath) {
            try {
              controller.validateState(rawState);
            } catch (error) {
              return notOpened("unsupported_target", {
                code: "invalid_state",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (controller?.guardAgentPresentation) {
            const check = await controller.guardAgentPresentation(next);
            if (!check.ok) return blockedUnsaved(check.blockedForms);
          } else if (controller?.blocksNavigation?.(next)) {
            return blockedUnsaved(controller.blockedForms?.(next));
          }
          if (presentationAppliesAddress(currentPage.address, resolved.address, hasStatePatch)) {
            // Apply an explicit address with its live overrides so a mounted component never sees a superseded value.
            const address = hasStatePatch && sameBasePath
              ? controller?.presentationAddress?.(resolved.address, rawState) ?? resolved.address
              : resolved.address;
            if (address !== currentPage.address || !current.restorable || current.view !== nextView) {
              const addressTarget: DisplayTarget = { kind: "page", ...resolved, address };
              commit({ target: addressTarget, view: nextView, restorable: true });
              const opened = await write(addressTarget, nextView, "replace");
              if (host.embedded && !opened) {
                commit(current);
                return notOpened("forbidden");
              }
              if (hasStatePatch) await nextTick();
            }
          }
          if (hasStatePatch) {
            if (controller) {
              try {
                controller.applyState(rawState);
              } catch (error) {
                return notOpened("unsupported_target", {
                  code: "invalid_state",
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            } else {
              // Never splice raw state into the URL without the panel manifest: buffer it until the page controller
              // mounts so non-deepLink fields never leak into the address bar and still apply once mounted.
              const merged = { ...(pendingStates.get(resolved.instance) ?? {}), ...rawState };
              pendingStates.set(resolved.instance, merged);
              liveState.value = {
                seq: (liveState.value?.seq ?? 0) + 1,
                instance: resolved.instance,
                patch: merged,
              };
            }
          }
          await nextTick();
          await nextTick();
          const livePage = shown.value.target?.kind === "page" && shown.value.target.instance === resolved.instance
            ? shown.value.target
            : null;
          if (livePage && (!shown.value.restorable || shown.value.view !== nextView)) {
            commit({ target: livePage, view: nextView, restorable: true });
            await write(livePage, nextView, "replace");
          }
        } else {
          if (rawState !== undefined && Object.keys(rawState).length > 0) {
            const patch = { ...rawState };
            pendingStates.set(resolved.instance, patch);
            liveState.value = {
              seq: (liveState.value?.seq ?? 0) + 1,
              instance: resolved.instance,
              patch,
            };
          } else {
            pendingStates.delete(resolved.instance);
            liveState.value = null;
          }
          commit({ target: nextTarget, view: nextView, restorable: true });
          const opened = await write(resolved, nextView, "push");
          if (host.embedded && !opened) {
            commit(current);
            return notOpened("forbidden");
          }
          await waitForLoadSettle(nextTarget);
        }

        const shownNow = selected();
        return shownNow.load.status === "error"
          ? { status: "opened", reason: "load_error", current: shownNow, ...(shownNow.load.error ? { error: shownNow.load.error } : {}) }
          : { status: "opened", reason: "target_selected", current: shownNow };
      });
      if (frame.target.kind === "page_action" || frame.target.kind === "fill_form") {
        inFlightPageActions.add(run);
        void run.finally(() => inFlightPageActions.delete(run));
      }
      return run;
    },
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
