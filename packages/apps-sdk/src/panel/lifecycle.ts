import { watch, type Ref } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageDraftLink } from "@ontomato/contracts/page-draft";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { PanelDeepLinkStateValue, PanelObjectIdentity, PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { DefinitionRevision } from "@ontomato/contracts/product-subscriptions";
import { panelOperationSchema } from "@ontomato/contracts/panel-manifest";
import { receivePanelDraft, type PanelDraftSource } from "./draft";
import { PanelDraftUnusable, unreadableDraft } from "./draft-refusal";
import { pageDraftLinkOf, type PanelInstance } from "./instance";
import { checkPanelValue, type PanelFieldValue } from "./state";

/*
 * One panel instance's run beside its host, the same in a panel's frame and in the platform's own document: what it
 * reports as it changes (its deep-linkable state, page context, unsaved state, operations, a settled draft, a failure)
 * and what it takes back (whether the reader sees it, a new address, a changed projection, a changed object). While the
 * reader does not see it the instance reads nothing on its own: a new address, a changed projection and a changed object
 * are held, and acted on once when it is seen again — the latest address, each projection at its latest revision, each
 * object once however often it changed (an untargeted refresh covers them all). A changed definition is never applied
 * over an unsaved form.
 */

/** What an instance tells its host. */
export interface PanelRunReports {
  state(state: Record<string, PanelDeepLinkStateValue>, fromAddress: string): void;
  context(context: PageContext): void;
  dirty(dirty: boolean): void;
  /** The operations the header draws and an agent lists, as data. */
  operations(operations: PanelOperation[]): void;
  draftSettled(link: PageDraftLink): void;
  /**
   * The draft the address names cannot be used here (it could not be read, was written for another page, or no form
   * takes it): the panel goes on as it is, and the host tells the reader why.
   */
  draftRefused(refusal: PanelDraftUnusable): void;
  /** The draft the address names is in its form, or changes nothing there: the page is now what it opens. */
  draftOpened(): void;
  /** The panel cannot run, and why; the host shows it where the panel would have been. */
  failed(reason: unknown): void;
}

export interface PanelRunOptions {
  instance: PanelInstance;
  pageKey: string;
  /** The instance's address, as the host last gave it. */
  address: Ref<string>;
  /** Whether the instance holds anything unsaved, its forms' edits and any other the panel holds. */
  isDirty(): boolean;
  readPageDraft: PanelDraftSource["readPageDraft"];
  /** Draws a projection again at a newer revision of its definition. */
  projectionChanged(id: string, revision?: number): void;
  /** Reads again what the instance shows of one object, or of every object (null). */
  refreshObject(target: PanelObjectIdentity | null): void;
  reports: PanelRunReports;
}

/** What the host gives an instance back. */
export interface PanelRun {
  /** Reads the draft the first address names, once the panel is drawn. */
  start(): Promise<void>;
  activity(active: boolean): void;
  address(next: string): void;
  projectionsChanged(revisions: readonly (Pick<DefinitionRevision, "id"> & { revision?: number })[]): void;
  objectChanged(target: PanelObjectIdentity | null): void;
}

export function runPanel(options: PanelRunOptions): PanelRun {
  const { instance, address, isDirty, reports } = options;
  let currentDraft = "";
  async function followDraft() {
    const link = pageDraftLinkOf(address.value);
    const key = link ? JSON.stringify(link) : "";
    if (key === currentDraft) return;
    currentDraft = key;
    if (!link) return;
    // A draft that cannot be used is that draft's problem: the panel goes on without it.
    await receivePanelDraft(options.pageKey, instance.forms, { readPageDraft: options.readPageDraft },
      link, instance.receiveDraft, () => currentDraft === key, () => { if (currentDraft === key) reports.draftOpened(); },
      instance.rollbackDraft)
      .catch((reason: unknown) => reports.draftRefused(reason instanceof PanelDraftUnusable ? reason : unreadableDraft(link.path, reason)));
  }
  async function followAddress(next: string) {
    const hasState = new URL(next, "http://page.invalid").searchParams.has("state");
    const hasDraft = pageDraftLinkOf(next) !== null;
    // A draft link without an explicit `state` parameter opens over the page as it is rather than wiping deep-link
    // selections (which would unmount conditional `v-if` forms before the draft is even read).
    if (hasState || !hasDraft) {
      const desired = panelAddressState(next);
      const patch: Record<string, PanelFieldValue> = {};
      for (const [name, field] of Object.entries(instance.manifest.state)) {
        if (!field.deepLink) continue;
        const value = checkPanelValue(instance.manifest, name, desired[name] ?? field.default ?? null);
        if (JSON.stringify(instance.state.values.value[name]) !== JSON.stringify(value)) patch[name] = value;
      }
      instance.state.setState(patch);
    }
    address.value = next;
    await followDraft();
  }
  const followAddressNow = (next: string) => void followAddress(next).catch(reports.failed);

  // The page context follows the state, the address and the names of the objects read since: a name that arrives after
  // its selection reaches the host as a context of its own.
  watch(() => instance.pageContext.value, (context) => reports.context(context as PageContext), { deep: true, immediate: true });
  watch([() => instance.state.values.value, address], () => reports.state(instance.deepLink(), address.value), { deep: true, immediate: true });
  instance.onDraftSettled(reports.draftSettled);
  watch(() => instance.operations.value, (operations) => {
    // The description carries data only; a call is run by the instance itself.
    reports.operations(operations.map(({ invoke: _invoke, ...operation }) => panelOperationSchema.parse(operation)));
  }, { immediate: true });

  const waiting = new Map<string, { id: string; revision?: number }>();
  const refreshProjections = () => {
    for (const { id, revision } of waiting.values()) options.projectionChanged(id, revision);
    waiting.clear();
  };
  let active = true;
  let heldAddress: string | null = null;
  let heldAll = false;
  const heldObjects = new Map<string, PanelObjectIdentity>();
  const resume = () => {
    if (heldAddress !== null) followAddressNow(heldAddress);
    if (!isDirty()) refreshProjections();
    if (heldAll) options.refreshObject(null);
    else for (const target of heldObjects.values()) options.refreshObject(target);
    heldAddress = null;
    heldAll = false;
    heldObjects.clear();
  };
  watch(isDirty, (dirty) => {
    reports.dirty(dirty);
    if (!dirty && active) refreshProjections();
  }, { immediate: true });

  return {
    start: followDraft,
    activity(next) {
      active = next;
      if (active) resume();
    },
    address(next) {
      if (active) followAddressNow(next);
      else heldAddress = next;
    },
    projectionsChanged(revisions) {
      for (const revision of revisions) {
        const current = waiting.get(revision.id);
        if (revision.revision === undefined || (current !== undefined && current.revision === undefined))
          waiting.set(revision.id, { id: revision.id });
        else if ((current?.revision ?? 0) < revision.revision)
          waiting.set(revision.id, revision);
      }
      if (active && !isDirty()) refreshProjections();
    },
    objectChanged(target) {
      if (active) options.refreshObject(target);
      else if (target) heldObjects.set(`${target.objectType}\u0000${target.primaryKey}`, target);
      else heldAll = true;
    },
  };
}
