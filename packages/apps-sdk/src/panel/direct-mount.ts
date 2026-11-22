import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { effectScope, h, ref, watch, type Component, type Ref, type VNode, type Slots } from "vue";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelNestedReadRequest } from "@ontomato/contracts/panel-host";
import type { DirectPanelMount as HostDirectPanelMount, DirectPanelRun } from "@ontomato/platform-shell";
import { createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions } from "./direct";
import { runPanel } from "./lifecycle";
import { type PanelMessages } from "@ontomato/contracts/product-panels";
import { panelHumanOperations, type PanelOperationUse } from "./human-operations";
import type { PlatformRequests } from "./platform-objects";
import { readComponentPackage, readPageDraft, readProjectionForRender, recordDraftCreated } from "./platform-requests";
import type { ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { createPanelText } from "./text";
import { draftRefusalText } from "./draft-refusal";
import { isListAttachedPanelMember } from "./row-member";
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
  loadDomainComponent?(runtime: DomainComponentRuntime): Promise<Component>;
  /** The application use the panel runs as (with `root: "frame"` for the frame); a preview runs as none and runs no operation. */
  use: PanelOperationUse | null;
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
    const domainSources = new WeakMap<object, DomainComponentRuntime>();
    const translate = options.translate ?? ((key: string) => key);
    const instance = createDirectPanelInstance(options.manifest, {
      read: options.read,
      confirmOperation: options.confirmOperation,
      expandPageComposer: options.expandPageComposer,
      navigate: options.navigate,
      nested: options.nested,
      ...(run.currentEntry ? { currentEntry: run.currentEntry } : {}),
      ...(run.frameState ? { frameState: run.frameState } : {}),
      ...(options.memberPath ? { memberPath: options.memberPath } : {}),
      translate: options.translate,
      // A draft a form could not take is the draft's problem: the reader is told, the panel goes on.
      reportDraftError: (reason) => run.draftRefused(translate("platform.draftFailed", { reason: reason instanceof Error ? reason.message : String(reason) })),
      text: createPanelText(options.messages, options.locale, options.defaultLocale),
      operations: panelHumanOperations(options.use, requests),
      recordDraftCreated: (link, id) => recordDraftCreated(requests, link, id),
      readProjection: async (id) => {
        const { projection, domainComponent } = await readProjectionForRender(requests, id);
        if (domainComponent) domainSources.set(projection, domainComponent);
        return projection;
      },
      async loadDomainComponent(projection) {
        const runtime = domainSources.get(projection);
        if (!runtime || !options.loadDomainComponent) throw new Error(`Component '${projection.componentId}' has no runtime for this projection`);
        return options.loadDomainComponent(runtime);
      },
      // Each package is read once for this run: a deployment selects one release of it at a time.
      readComponentPackage: (() => {
        const read = new Map<string, Promise<ComponentPackageResponse>>();
        return (name: string) => {
          if (!read.has(name)) read.set(name, readComponentPackage(requests, name));
          return read.get(name)!;
        };
      })(),
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
      reports: { ...run, draftRefused: (refusal) => run.draftRefused(draftRefusalText(refusal, translate)) },
    });
    // A draft that none of this panel's forms performs is not this panel's: once every member has registered and none
    // takes it, the reader is told so, rather than waiting for a form that will never come; the panel goes on.
    watch(instance.unclaimedDraft, (unclaimed) => {
      if (unclaimed !== null) run.draftRefused(translate("platform.panelDraftUnclaimed", { ...unclaimed }));
    });
    // Every member the panel declares is held from the start, drawn or not: its operations are listed, a draft is offered
    // to it, and the panel's own code reads its data, whether or not a layout or a template places it.
    // A member that cannot be read is that member's failure, not the panel's: whoever draws it (`<Projection>`) or reads
    // it (`usePanelData`) shows the reason in its place, from this same hold; the rest of the panel goes on.
    const declaredMembers = Object.entries(options.manifest.members)
      .filter(([, member]) => !isListAttachedPanelMember(member))
      .map(([memberKey]) => memberKey);
    if (declaredMembers.length) {
      instance.forms.setUndrawnReady(false);
      void Promise.allSettled(declaredMembers.map((member) => instance.placing(member)))
        .finally(() => instance.forms.setUndrawnReady(true));
    }
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
