import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { computed, readonly, shallowReactive, shallowRef, type DeepReadonly, type Ref } from "vue";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelOpenRequestSchema, type PanelDeepLinkStateValue, type PanelManifest, type PanelOperationCall, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { childObjectNameKey, createPanelState, objectNameKey, panelSelection, type PanelInitialState, type PanelStateStore } from "./state";
import type { PanelText } from "./text";
import { panelOperations } from "./operations";
import type { PanelProjectionRegistration } from "./ports";
import { PanelFormAdapters, type PageDraftLink, type ReceivedPanelDraft } from "./draft";
import { handlerFor } from "./handlers";
import { pageDraftLink } from "@ontomato/contracts/page-draft";
import type { PanelOperationBinding } from "./types";
import type { AppBridgeConfirmPanelOperationResult } from "@ontomato/contracts/app-bridge";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { ConfirmPanelOperation, PanelHumanOperations, PanelOperationDescriptor, PanelWriteInvocation } from "./human-operations";
import type { ReadOperationInput } from "./read-operation-input";

/*
 * One panel instance's runtime (overall design 3.4): its state, the projections it registered, the operations it offers,
 * the draft its address named, and the page context a message carries. A panel author declares state and composition
 * and places `<Projection>` elements; none of this is written per panel.
 *
 * The three things that make it one instance and not another: its own state, its own registered projections, and its own
 * page context projected from that state.
 */

/** What an instance needs from the platform: the reader's request path, and the panel's own key and address. */
export interface PanelInstanceOptions {
  /** The page's registration key: the application use's pageKey, which a draft names too. */
  pageKey: string;
  url: () => string;
  label: () => string;
  initial?: PanelInitialState;
  /** Reads a current projection by ID, as the reader. */
  readProjection: (id: string) => Promise<ProductProjection>;
  /** Records, as the reader, the object a create draft's save created, so the draft addresses it from then on. */
  recordDraftCreated: (link: PageDraftLink, id: string) => Promise<void>;
  /** Translates platform message keys (such as object-union type display names) in the current locale. */
  translate?: (key: string) => string;
  /** The panel's own words (its content's messages) in the current language: what a state operation is called. */
  text: PanelText;
  /** The platform's coordinator, which runs this panel's operations as the reader. */
  operations: PanelHumanOperations;
  /** The host's confirmation and single dispatch of a prepared write. */
  confirmOperation: ConfirmPanelOperation;
  reportDraftError?: (reason: unknown) => void;
}

export interface PanelInstance {
  readonly manifest: PanelManifest;
  readonly state: PanelStateStore;
  readonly pageContext: DeepReadonly<Ref<PageContext>>;
  /** Computed afresh from the registered projections; a reader never changes it. */
  readonly operations: Readonly<Ref<readonly PanelOperationBinding[]>>;
  readonly projections: DeepReadonly<Ref<readonly PanelProjectionRegistration[]>>;
  /** The form adapters its projections registered, for the draft its address names. */
  readonly forms: PanelFormAdapters;
  /** The draft this instance received, once one arrived. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  receiveDraft(value: ReceivedPanelDraft<Record<string, unknown>>): void;
  /**
   * Ends the draft a form in `slot` holds, once the reader saved or discarded it: a saved create draft first records the
   * object it created (`created`), then whoever listens hears which draft ended. A slot that holds no draft has nothing
   * to end.
   */
  settleDraft(slot: string, created?: string): Promise<void>;
  /** Hears each draft that ended, by its link; the returned function stops it. */
  onDraftSettled(listener: (link: PageDraftLink) => void): () => void;
  /**
   * Whether the draft this instance holds is one none of its forms performs: every slot its declaration names has
   * registered its projection, and every form among them was offered the draft and found that its owner's form for the
   * draft's target performs another operation. While a slot is still to register it is false, since that may be the form
   * that takes the draft.
   */
  readonly unclaimedDraft: Readonly<Ref<boolean>>;
  register(registration: PanelProjectionRegistration): () => void;
  /** Runs one described operation here, with the reader's own credential. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Runs one operation a projection publishes, by its handler reference, with the call it is given. */
  runHandler(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** The owner's description of one of this panel's operations, by its ID. */
  describeOperation(operationId: string): Promise<PanelOperationDescriptor>;
  /** Runs a read-only operation as the reader: what it read, with nothing written and nothing reported changed. */
  readOperation(operationId: string, call: { target: PanelOperationCall["target"]; input: ReadOperationInput }): Promise<PanelReadOperationResult>;
  /**
   * Runs a write as the reader, the way an agent's runs: one intent freezes the calls, the host confirms it where the
   * owner or a batch asks and dispatches it once, and the objects the owner reports changed are read again here. A
   * cancelled confirmation writes nothing.
   */
  writeOperation(operationId: string, invocation: PanelWriteInvocation): Promise<AppBridgeConfirmPanelOperationResult>;
  objectChanged(object: PanelObjectIdentity): void;
  refreshObjects(): void;
  onObjectChanged(listener: (object: PanelObjectIdentity | null) => void): () => void;
  /** Reads a projection record by ID, as the reader. */
  projection(id: string): Promise<ProductProjection>;
  /**
   * Keeps the names the owner of a type gave the objects this instance read, so the page context names a selected object
   * by its owner's label. Only reads call it: a name is never typed in, guessed or carried in an address.
   */
  nameObjects(objectType: string, objects: readonly { primaryKey: string; label: string }[]): void;
  /** Keeps owner labels for child objects read under a parent identity and declared collection. */
  nameChildObjects(parent: PanelObjectIdentity, collection: string, objects: readonly { primaryKey: string; label: string }[]): void;
  /** Whether this instance holds unsaved changes: a received draft, or a form the reader edited. */
  dirty(): boolean;
  /** The state an address or an open request may carry, for this instance. */
  deepLink(): Record<string, PanelDeepLinkStateValue>;
}

/**
 * One panel instance: everything belongs to it, so two instances of one panel share the declaration and its reads and
 * nothing else.
 */
export function createPanelInstance(manifest: PanelManifest, options: PanelInstanceOptions): PanelInstance {
  const state = createPanelState(manifest, options.initial);
  const objectListeners = new Set<(object: PanelObjectIdentity | null) => void>();
  const settledListeners = new Set<(link: PageDraftLink) => void>();
  const objectChanged = (object: PanelObjectIdentity | null) => {
    for (const listener of objectListeners) listener(object);
  };
  const registrations = shallowRef<readonly PanelProjectionRegistration[]>([]);
  async function writeOperation(operationId: string, invocation: PanelWriteInvocation) {
    const result = await options.confirmOperation(await options.operations.prepare(operationId, invocation));
    // Only the objects the owner reports a successful write changed; a refusal, a failure or an unknown result changes none.
    const outcome = result.decision === "confirm" && result.response.kind === "dispatched" ? result.response.outcome : null;
    if (outcome?.kind === "success" || outcome?.kind === "batch")
      for (const object of outcome.affected?.objects ?? []) objectChanged(object);
    return result;
  }
  const operations = computed(() => panelOperations(manifest, registrations.value, state, forms, options.text, writeOperation));
  const forms = new PanelFormAdapters(options.reportDraftError);
  const draft = shallowRef<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const names = shallowReactive(new Map<string, string>());
  const translate = options.translate ?? ((key: string) => key);
  const pageContext = computed<PageContext>(() => ({
    pageKey: options.pageKey,
    url: options.url(),
    label: options.label(),
    selection: panelSelection(manifest, state.values.value, names, translate),
  }));
  return {
    manifest,
    state,
    pageContext,
    operations,
    forms,
    draft: readonly(draft) as Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>,
    receiveDraft(value) { draft.value = value; },
    async settleDraft(slot, created) {
      const ended = draft.value;
      if (ended?.slot !== slot) return;
      if (created !== undefined && ended.target.id === undefined)
        await options.recordDraftCreated(ended.link, created);
      if (draft.value === ended) draft.value = null;
      for (const listener of settledListeners) listener(ended.link);
    },
    onDraftSettled(listener) {
      settledListeners.add(listener);
      return () => settledListeners.delete(listener);
    },
    unclaimedDraft: computed(() => {
      const registered = registrations.value;
      if (!Object.keys(manifest.slots).every((slot) => registered.some((registration) => registration.slot === slot))) return false;
      const formSlots = registered
        .filter((registration) => registration.ports.operations.some((operation) => operation.kind === "form.save"))
        .map((registration) => registration.slot);
      return forms.unclaimed(formSlots);
    }),
    projections: readonly(registrations),
    register(registration) {
      // In the declaration's slot order, whichever projection finished loading first: the operations an agent lists and
      // the header draws, and the forms a draft is offered to, keep the panel's own order.
      const order = Object.keys(manifest.slots);
      registrations.value = [...registrations.value, registration]
        .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
      return () => {
        registrations.value = registrations.value.filter((item) => item !== registration);
      };
    },
    invoke(id, input) {
      const found = operations.value.find((operation) => operation.id === id);
      if (!found) throw new Error(`The panel offers no operation '${id}'`);
      return found.invoke(input);
    },
    async runHandler(handlerRef, call) {
      const result = await handlerFor(handlerRef).invoke(call);
      if (call.target?.kind === "object") objectChanged(call.target);
      return result;
    },
    describeOperation: (operationId) => options.operations.describe(operationId),
    readOperation: (operationId, call) => options.operations.read(operationId, call),
    writeOperation,
    objectChanged,
    refreshObjects: () => objectChanged(null),
    onObjectChanged(listener) {
      objectListeners.add(listener);
      return () => objectListeners.delete(listener);
    },
    projection: (id) => options.readProjection(id),
    nameObjects(objectType, objects) {
      for (const { primaryKey, label } of objects) names.set(objectNameKey(objectType, primaryKey), label);
    },
    nameChildObjects(parent, collection, objects) {
      for (const { primaryKey, label } of objects) names.set(childObjectNameKey(parent, collection, primaryKey), label);
    },
    dirty: () => draft.value !== null || forms.dirty(),
    deepLink: () => state.deepLinkable(),
  };
}

/**
 * Applies what an address or an open request carries, checked against the declaration: only the fields the panel offers
 * in an address are restorable, so a credential or a form value never arrives that way.
 */
export function applyPanelRequest(manifest: PanelManifest, state: PanelStateStore, request: unknown): void {
  const parsed = panelOpenRequestSchema.parse(request);
  const patch: Record<string, PanelStateValue> = {};
  for (const [name, value] of Object.entries(parsed.state)) {
    if (!manifest.state[name]?.deepLink) continue;
    patch[name] = value;
  }
  state.setState(patch);
}

/** The draft link an address carries, if it carries one. */
export function pageDraftLinkOf(address: string): PageDraftLink | null {
  return pageDraftLink(Object.fromEntries(new URL(address, "http://page.invalid").searchParams));
}
