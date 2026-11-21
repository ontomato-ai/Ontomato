import { effectScope, h, ref, watch, type Ref, type VNode, type Slots } from "vue";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelNestedReadRequest } from "@ontomato/contracts/panel-host";
import type { DirectPanelMount as HostDirectPanelMount, DirectPanelRun } from "@ontomato/platform-shell";
import { createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions } from "./direct";
import { runPanel } from "./lifecycle";
import type { PanelUseRef } from "@ontomato/contracts/panel-agent";
import { directProjectionSchema, type PanelMessages } from "@ontomato/contracts/product-panels";
import { panelHumanOperations } from "./human-operations";
import type { PlatformRequests } from "./platform-objects";
import { readPageDraft, readProjectionRecord, recordDraftCreated } from "./platform-requests";
import { createPanelText } from "./text";
import PanelMember from "./PanelMember.vue";

/*
 * A panel drawn directly in the platform's own document (design 5): the host lays out the panel's containers and asks
 * the mount for each member; the mount runs the instance beside the host by the same rules a panel's frame does — the
 * deep-linkable state, page context, unsaved state and operations reported as they change; the address, the reader's
 * attention, changed projections and changed objects taken back, held while the reader does not see it — and reads each
 * member's data through the host's one read port.
 */

export interface DirectPanelMountOptions extends Pick<DirectPanelInstanceOptions, "read" | "confirmOperation" | "translate" | "expandPageComposer" | "navigate"> {
  manifest: PanelManifest;
  run: DirectPanelRun;
  /** The platform's request path, as the reader: drafts, projection records and the coordinator's operations. */
  requests: PlatformRequests;
  /** The application use the panel runs as; a candidate preview runs as none and runs no operation. */
  use: PanelUseRef | null;
  /** The panel's own words (its content's messages), in the platform's language with the deployment's default behind. */
  messages: PanelMessages;
  locale: Readonly<Ref<string>>;
  defaultLocale: string;
  /**
   * Where this instance sits in the panel the reader opened: the path of the members that placed it, the last one with
   * the selection that chose it. The opened panel has none. Every member path, operation ID and intent this instance
   * sends starts with it.
   */
  memberPath?: PanelMemberPath;
  /**
   * Runs the panel one of this instance's members places from the panel's state: `memberPath` is that member's segment,
   * relative to this instance, with the selection the state made; `run` is how the placed panel reports to this one.
   * The host reads the placed panel's current definition at this instance's path plus `memberPath`, mounts it in an
   * element of its own with its own scope, and disposes of both with the mount. A member that places the chosen object's
   * detail panel sends the object alone (`selection: { stateValue }`): the platform answers which panel it is, and the
   * placed instance's own `memberPath` ends with that segment completed by `target: { panelId }` of the answer, which
   * every read and operation of it needs.
   */
  nested(memberPath: ProductPanelNestedReadRequest["memberPath"], run: DirectPanelRun): Promise<{ element: HTMLElement; mount: DirectPanelMount }>;
}

/**
 * One run of a panel the platform runs: the host's own view of it (the shell owns it, as the one that drives it), with
 * the instance itself and its members as `<Projection>` draws them.
 */
export interface DirectPanelMount extends HostDirectPanelMount {
  readonly instance: DirectPanelInstance;
  /** The member the panel's template places under this key, with what the template places in its component's slots. */
  member(ref: string, slots?: Slots): VNode;
}

export function mountDirectPanel(options: DirectPanelMountOptions): DirectPanelMount {
  const scope = effectScope();
  const { run } = options;
  return scope.run(() => {
    const address = ref(run.url());
    const { requests } = options;
    const instance = createDirectPanelInstance(options.manifest, {
      read: options.read,
      confirmOperation: options.confirmOperation,
      expandPageComposer: options.expandPageComposer,
      navigate: options.navigate,
      nested: options.nested,
      ...(options.memberPath ? { memberPath: options.memberPath } : {}),
      translate: options.translate,
      // A draft the panel cannot take fails it where it would have been, as in a frame.
      reportDraftError: run.failed,
      text: createPanelText(options.messages, options.locale, options.defaultLocale),
      operations: panelHumanOperations(options.use, requests),
      recordDraftCreated: (link, id) => recordDraftCreated(requests, link, id),
      readProjection: async (id) => directProjectionSchema.parse(await readProjectionRecord(requests, id, true)),
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
      readPageDraft: (sessionId, runId, path) => readPageDraft(requests, sessionId, runId, path),
      projectionChanged: (id, revision) => instance.projectionChanged(id, revision),
      refreshObject: (target) => (target ? instance.refresh({ objects: [target], objectTypes: [] }) : instance.refreshAll()),
      reports: run,
    });
    // A draft that none of this panel's forms performs is not this panel's: once every member has registered and none
    // takes it, the panel fails with that, rather than waiting for a form that will never come.
    watch(instance.unclaimedDraft, (unclaimed) => {
      if (unclaimed !== null) run.failed(new Error((options.translate ?? String)("platform.panelDraftUnclaimed", { ...unclaimed })));
    });
    // Every member the panel declares is held from the start, drawn or not: its operations are listed, a draft is offered
    // to it, and the panel's own code reads its data, whether or not a layout or a template places it.
    // A member that cannot be read is that member's failure, not the panel's: whoever draws it (`<Projection>`) or reads
    // it (`usePanelData`) shows the reason in its place, from this same hold; the rest of the panel goes on.
    for (const member of Object.keys(options.manifest.members)) void instance.placing(member).then(undefined, () => undefined);
    void panelRun.start().catch(run.failed);
    return {
      instance,
      member: (ref, slots) => h(PanelMember, { instance, member: ref, key: `${ref}:${instance.projectionVersion(ref)}` }, slots),
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
