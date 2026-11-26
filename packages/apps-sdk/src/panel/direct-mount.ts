import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { effectScope, h, ref, type Component, type Ref, type VNode, type Slots } from "vue";
import type { PanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelNestedReadRequest } from "@ontomato/contracts/panel-host";
import type { DirectPanelMount as HostDirectPanelMount, DirectPanelRun } from "@ontomato/platform-shell";
import {
  createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions, type DirectProjectionReadOptions,
  type MemberInputs,
} from "./direct";
import { runPanel } from "./lifecycle";
import { type PanelMessages, type ProductProjectionRenderResponse } from "@ontomato/contracts/product-panels";
import { panelHumanOperations, type PanelOperationUse } from "./human-operations";
import type { PlatformRequests } from "./platform-objects";
import { readComponentPackage, readProjectionForRender } from "./platform-requests";
import type { ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { createPanelText } from "./text";
import { checkPanelValue, type PanelFieldValue } from "./state";
import PanelMember from "./PanelMember.vue";

/*
 * A panel drawn directly in the platform's own document (design 5): the host lays out the panel's containers and asks
 * the mount for each member; the mount runs the instance beside the host by the same rules a panel's frame does — the
 * deep-linkable state, page context, unsaved state and operations reported as they change; the address, the reader's
 * attention, changed projections and changed objects taken back, held while the reader does not see it — and reads each
 * member's data through the host's one read port.
 */

export interface DirectPanelMountOptions extends Pick<DirectPanelInstanceOptions, "read" | "confirmOperation" | "translate" | "expandPageComposer" | "navigate" | "currentUser" | "localDrafts"> {
  manifest: PanelManifest;
  run: DirectPanelRun;
  /** The platform's request path, as the reader: projection records and the coordinator's operations. */
  requests: PlatformRequests;
  /**
   * Optional host hook for reading a projection's render payload (e.g. from bundled panel definitions or a
   * revision-checked client cache). Falls back to `readProjectionForRender(requests, id)` when omitted.
   */
  readProjection?(id: string, options?: DirectProjectionReadOptions): Promise<ProductProjectionRenderResponse>;
  loadDomainComponent?(runtime: DomainComponentRuntime): Promise<Component>;
  /** Author-registered components declared in `manifest.components`, keyed by component ID. */
  panelDomainComponents?: Readonly<Record<string, DomainComponentRuntime>>;
  /** Built-in SDK projection component IDs already known from bundled/cached definitions to preload before mount. */
  preloadComponentIds?: readonly string[];
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
  /**
   * The member the panel's template places under this key, with the inputs a slot supplies to an instance of its own, the
   * values that follow the page, and its slot content.
   */
  member(
    ref: string,
    slots?: Slots,
    inputs?: Readonly<Record<string, RuntimeJsonValue>>,
    values?: Readonly<Record<string, RuntimeJsonValue>>,
  ): VNode;
}

export function mountDirectPanel(options: DirectPanelMountOptions): DirectPanelMount {
  const scope = effectScope();
  const { run } = options;
  return scope.run(() => {
    const address = ref(run.url());
    const { requests } = options;
    const domainSources = new WeakMap<object, DomainComponentRuntime>();
    const instance = createDirectPanelInstance(options.manifest, {
      boundOutputs: run.boundOutputs,
      overlayRoot: run.overlayRoot,
      windowOverlayRoot: run.windowOverlayRoot,
      shown: run.shown,
      read: options.read,
      confirmOperation: options.confirmOperation,
      expandPageComposer: options.expandPageComposer,
      navigate: options.navigate,
      ...(run.navigateBack ? { navigateBack: (fallback: string) => run.navigateBack!(fallback, options.navigate) } : {}),
      nested: options.nested,
      ...(run.currentEntry ? { currentEntry: run.currentEntry } : {}),
      ...(run.frameState ? { frameState: run.frameState } : {}),
      ...(run.registerBackHandler ? { registerBackHandler: run.registerBackHandler } : {}),
      ...(run.confirmLeaveUnsaved ? { confirmLeaveUnsaved: () => (instance.dirty() ? run.confirmLeaveUnsaved!() : Promise.resolve(true)) } : {}),
      ...(run.currentUser ?? options.currentUser ? { currentUser: run.currentUser ?? options.currentUser } : {}),
      ...(options.localDrafts ? { localDrafts: options.localDrafts } : {}),
      ...(options.memberPath ? { memberPath: options.memberPath } : {}),
      translate: options.translate,
      text: createPanelText(options.messages, options.locale, options.defaultLocale),
      operations: panelHumanOperations(options.use, requests),
      readProjection: async (id, readOptions) => {
        const read = options.readProjection
          ? (readOptions ? options.readProjection(id, readOptions) : options.readProjection(id))
          : readProjectionForRender(requests, id);
        const { projection, domainComponent } = await read;
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
      address,
      isDirty: () => instance.dirty(),
      projectionChanged: (id, revision) => instance.projectionChanged(id, revision),
      refreshObject: (target) => (target ? instance.refresh({ objects: [target], objectTypes: [] }) : instance.refreshObjects()),
      onAddressPending: (pending) => instance.setAddressPending(pending),
      reports: {
        state: run.state,
        context: run.context,
        dirty: run.dirty,
        operations: run.operations,
        failed: run.failed,
      },
    });
    // Every member the panel declares is held from the start, drawn or not: its operations are listed and its
    // read-only outputs are available, whether or not a layout or a template places it.
    // A member that cannot be read is that member's failure, not the panel's: whoever draws it (`<Projection>`)
    // shows the reason in its place, from this same hold; the rest of the panel goes on.
    const declaredMembers = Object.keys(options.manifest.members);
    if (declaredMembers.length) {
      void Promise.allSettled(declaredMembers.map((member) => instance.placing(member)));
    }
    return {
      instance,
      member: (ref, slots, inputs, values) => h(PanelMember, {
        instance,
        member: ref,
        ...(inputs ? { inputs: inputs as MemberInputs } : {}),
        ...(values ? { values } : {}),
        key: `${ref}:${instance.projectionVersion(ref)}`,
      }, slots),
      address: (url) => panelRun.address(url),
      publicState: instance.publicState,
      findBlockedForms: (patch) => instance.findBlockedForms(patch as Record<string, PanelFieldValue>),
      checkAgentStateChange: (patch) => instance.checkAgentStateChange(patch as Record<string, PanelFieldValue>),
      requestStateChange: (patch, requestOptions) =>
        instance.requestStateChange(patch as Record<string, PanelFieldValue>, requestOptions),
      setState(patch) {
        const entries = Object.entries(patch);
        if (!entries.length) return;
        const checked: Record<string, PanelFieldValue> = {};
        for (const [name, value] of entries) checked[name] = checkPanelValue(options.manifest, name, value);
        instance.applyAuthorizedState(checked);
      },
      refresh(target, affected, operation) {
        // Unseen, what an operation changed is held as everything; seen, only the data it concerns are read again.
        if (affected && active) instance.refresh(affected, operation);
        else {
          if (operation) instance.operationCompleted({ operation, affected });
          panelRun.objectChanged(affected ? null : target);
        }
      },
      projectionsChanged: (revisions) => panelRun.projectionsChanged(revisions),
      activate(next) {
        active = next;
        instance.setActive(next);
        panelRun.activity(next);
      },
      invoke: (id, input) => instance.invoke(id, input),
      fillForm: (request) => instance.fillForm(request),
      executeAction: (request) => instance.executeAction(request),
      snapshotMeta() {
        const memberInstances = instance.memberInstances();
        const entryInstances = instance.entryInstances();
        const checkedKeys = instance.checkedKeys();
        return {
          panelInstanceId: instance.instanceId,
          ...(Object.keys(memberInstances).length ? { memberInstances } : {}),
          ...(Object.keys(entryInstances).length ? { entryInstances } : {}),
          ...(Object.keys(checkedKeys).length ? { checkedKeys } : {}),
        };
      },
      isLoading: () => instance.isLoading(),
      dispose() {
        instance.markDisposed();
        scope.stop();
      },
    };
  })!;
}
