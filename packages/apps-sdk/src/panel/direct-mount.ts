import { effectScope, h, ref, watch, type DeepReadonly, type Ref, type VNode } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageDraftLink } from "@ontomato/contracts/page-draft";
import type { DirectPanelManifest, PanelDeepLinkStateValue, PanelObjectIdentity, PanelOperation } from "@ontomato/contracts/panel-manifest";
import type { DefinitionRevision } from "@ontomato/contracts/product-subscriptions";
import { createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions, type PanelOperationAffected } from "./direct";
import { runPanel } from "./lifecycle";
import type { PanelDraftSource } from "./draft";
import type { PanelFieldValue } from "./state";
import PanelMember from "./PanelMember.vue";

/*
 * A panel drawn directly in the platform's own document (design 5): the host lays out the panel's containers and asks
 * the mount for each member; the mount runs the instance beside the host by the same rules a panel's frame does — the
 * deep-linkable state, page context, unsaved state and operations reported as they change; the address, the reader's
 * attention, changed projections and changed objects taken back, held while the reader does not see it — and reads each
 * member's data through the host's one read port.
 */

/** What the host gives the instance to run with, and how it hears what the instance reports. */
export interface DirectPanelRun {
  pageKey: string;
  /** The instance's address when it opens. */
  url(): string;
  label(): string;
  /** The deep-linkable state the address requested. */
  initial: Readonly<Record<string, PanelDeepLinkStateValue>>;
  state(state: Record<string, PanelDeepLinkStateValue>, fromAddress: string): void;
  context(context: PageContext): void;
  operations(operations: PanelOperation[]): void;
  dirty(dirty: boolean): void;
  draftSettled(link: PageDraftLink): void;
  /** The panel cannot run, and why. */
  failed(reason: unknown): void;
}

export interface DirectPanelMountOptions
  extends Omit<DirectPanelInstanceOptions, "pageKey" | "url" | "label" | "initial" | "affected"> {
  manifest: DirectPanelManifest;
  run: DirectPanelRun;
  readPageDraft: PanelDraftSource["readPageDraft"];
}

/** What the host draws and drives the instance with. */
export interface DirectPanelMount {
  readonly instance: DirectPanelInstance;
  /** The member the layout places under this key. */
  member(ref: string): VNode;
  /** The instance's state now, which the layout's conditions read. */
  readonly values: DeepReadonly<Ref<Record<string, PanelFieldValue>>>;
  /** The address changed from outside (back, a link): the instance follows it. */
  address(url: string): void;
  /** What an operation changed (or, with neither, everything shown) is read again. */
  refresh(target: PanelObjectIdentity | null, affected?: PanelOperationAffected): void;
  projectionsChanged(revisions: readonly DefinitionRevision[]): void;
  /** Whether the reader sees the instance; unseen, it reads nothing. */
  activate(active: boolean): void;
  /** A person's click on an operation in the platform's header. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  dispose(): void;
}

export function mountDirectPanel(options: DirectPanelMountOptions): DirectPanelMount {
  const scope = effectScope();
  const { run } = options;
  return scope.run(() => {
    const address = ref(run.url());
    const instance = createDirectPanelInstance(options.manifest, {
      ...options,
      pageKey: run.pageKey,
      url: () => address.value,
      label: run.label,
      initial: run.initial,
    });
    let active = true;
    const panelRun = runPanel({
      instance,
      pageKey: run.pageKey,
      address,
      isDirty: () => instance.dirty(),
      readPageDraft: options.readPageDraft,
      projectionChanged: (id) => instance.projectionChanged(id),
      refreshObject: (target) => (target ? instance.refresh({ objects: [target], objectTypes: [] }) : instance.refreshAll()),
      reports: run,
    });
    // A draft that none of this panel's forms performs is not this panel's: once every member has registered and none
    // takes it, the panel fails with that, rather than waiting for a form that will never come.
    watch(instance.unclaimedDraft, (unclaimed) => {
      if (unclaimed) run.failed(new Error((options.translate ?? String)("platform.panelDraftUnclaimed")));
    });
    void panelRun.start().catch(run.failed);
    return {
      instance,
      member: (ref) => h(PanelMember, { instance, member: ref, key: `${ref}:${instance.projectionVersion(ref)}` }),
      values: instance.state.values,
      address: (url) => panelRun.address(url),
      refresh(target, affected) {
        // Unseen, what an operation changed is held as everything; seen, only the data it concerns are read again.
        if (affected && active) instance.refresh(affected);
        else panelRun.objectChanged(affected ? null : target);
      },
      projectionsChanged: (revisions) => panelRun.projectionsChanged(revisions),
      activate(next) {
        active = next;
        instance.setActive(next);
        panelRun.activity(next);
      },
      invoke: (id, input) => instance.invoke(id, input),
      dispose: () => scope.stop(),
    };
  })!;
}
