import type { PanelUploadReceipt } from "@ontomato/contracts/panel-upload";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { computed, readonly, shallowReactive, shallowRef, type ComputedRef, type DeepReadonly, type Ref } from "vue";
import type { PageContext, PageHighlight } from "@ontomato/contracts/page-context";
import {
  panelOpenRequestSchema, panelOperationId, type PanelDeepLinkStateValue, type PanelManifest, type PanelMemberPath, type PanelOperationCall,
  type PanelStateValue,
} from "@ontomato/contracts/panel-manifest";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { createPanelCommands } from "./commands";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  childObjectNameKey, createPanelState, objectNameKey, panelSelection, stateObject, stateObjects, type PanelInitialState, type PanelObjectRef,
  type PanelStateStore,
} from "./state";
import type { PanelText } from "./text";
import { panelOperations } from "./operations";
import type { PanelProjectionRegistration } from "./ports";
import { PanelFormAdapters, type PageDraftLink, type ReceivedPanelDraft, type UnclaimedDraft } from "./draft";
import { handlerFor } from "./handlers";
import { pageDraftLink } from "@ontomato/contracts/page-draft";
import type { PanelOperationBinding } from "./types";
import type { AppBridgeConfirmPanelOperationResult } from "@ontomato/contracts/app-bridge";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
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
  translate?: (key: string, params?: Readonly<Record<string, string>>) => string;
  /** The panel's own words (its content's messages) in the current language: what a state operation is called. */
  text: PanelText;
  /** The platform's coordinator, which runs this panel's operations as the reader. */
  operations: PanelHumanOperations;
  /** The host's confirmation and single dispatch of a prepared write. */
  confirmOperation: ConfirmPanelOperation;
  reportDraftError?: (reason: unknown) => void;
  /**
   * Where this instance sits in the panel the reader opened (a panel placed from another's state), or nothing for the
   * opened panel itself: every member path, operation ID and page-context selection of this instance starts with it.
   */
  memberPath?: PanelMemberPath;
  /** A member's segment of a path: its key, with the selection that placed it where the panel's state chose it. */
  segmentOf?: (member: string) => PanelMemberPath[number];
}

/** A path that names at least one member: a nested publisher's, as the platform finds its operations by. */
export type PublisherPath = [PanelMemberPath[number], ...PanelMemberPath];

/** What a panel placed in one of an instance's members publishes into it: its operations, its unsaved changes. */
export interface NestedPublisher {
  readonly operations: readonly PanelOperationBinding[];
  dirty(): boolean;
  readonly context: PageContext | null;
}

export interface PanelInstance {
  readonly manifest: PanelManifest;
  readonly state: PanelStateStore;
  // A computed context, read only at its top: a deep read-only type of it recurses through the member paths' JSON values
  // (a nested panel's selection) without end.
  readonly pageContext: ComputedRef<PageContext>;
  /** Computed afresh from the registered projections; a reader never changes it. */
  readonly operations: Readonly<Ref<readonly PanelOperationBinding[]>>;
  /** A member handed over a value at one of its outputs: the state field the member binds it to takes it. */
  output(member: string, output: string, value: RuntimeJsonValue): void;
  /**
   * One parameter of a member, as its component reads and sets it: the panel state the member binds it to (its input of
   * that name, else its output of that name), or, unbound, the member's own value, which lives in this member alone.
   */
  memberParam(member: string, name: string): { readonly value: ComputedRef<RuntimeJsonValue | null>; set(value: RuntimeJsonValue | null): void };
  /** The values a member's component set for parameters bound to no state, by name. */
  ownParams(member: string): Readonly<Record<string, RuntimeJsonValue>>;
  readonly projections: DeepReadonly<Ref<readonly PanelProjectionRegistration[]>>;
  /** The form adapters its projections registered, for the draft its address names. */
  readonly forms: PanelFormAdapters;
  /** Set once a mounted form accepts a draft with changed fields. Cleared when the reader saves or discards it. */
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
   * What a draft this instance holds is for — its object's type and its operation — when none of its forms takes it:
   * every slot its declaration names has registered its projection, and every form among them declined the draft (none
   * binds the type, or none of that type performs the operation). Null otherwise, and while a slot is still to register,
   * since that may be the form that takes the draft.
   */
  readonly unclaimedDraft: Readonly<Ref<UnclaimedDraft | null>>;
  register(registration: PanelProjectionRegistration): () => void;
  /** Runs one described operation here, with the reader's own credential. */
  invoke(id: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Runs one operation a projection publishes, by its handler reference, with the call it is given. */
  runHandler(handlerRef: string, call: PanelOperationCall): Promise<unknown>;
  /** The owner's description of one of this panel's operations, by its ID. */
  describeOperation(operationId: string): Promise<PanelOperationDescriptor>;
  /** Stages a file the reader picked for one of this panel's operations that declares an upload (see `PanelHumanOperations.upload`). */
  uploadFile(operationId: string, file: File): Promise<PanelUploadReceipt>;
  /** Runs a read-only operation as the reader: what it read, with nothing written and nothing reported changed. */
  readOperation(operationId: string, call: { target: PanelOperationCall["target"]; input: ReadOperationInput }): Promise<PanelReadOperationResult>;
  /**
   * Runs a write as the reader, the way an agent's runs: one intent freezes the calls, the host confirms it where the
   * owner or a batch asks and dispatches it once. What the owner reports changed comes back through the host's refresh
   * port, not from here. A cancelled confirmation writes nothing. With the answer come the targets the owner named
   * when it prepared the write (each by its own label, as the confirmation shows them), for a receipt to name them too.
   */
  writeOperation(operationId: string, invocation: PanelWriteInvocation): Promise<PanelWriteResult>;
  objectChanged(object: PanelObjectIdentity): void;
  /**
   * Lets go of objects a write removed: a state holding one is cleared, a list state drops it, so nothing keeps choosing
   * or reading what is no longer there.
   */
  letGo(removed: readonly PanelObjectIdentity[]): void;
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
  /** Whether this instance holds unsaved changes: a received draft, a form the reader edited, or a panel placed in it. */
  dirty(): boolean;
  /** A member's path in the panel the reader opened: this instance's own, then the member's segment. */
  memberPathOf(member: string): PublisherPath;
  /** The ID a member's operation is published under: its path's member keys, then the operation's name. */
  operationIdOf(member: string, name: string): string;
  /** The path of the member that publishes an operation, which the platform finds it by; the opened panel's own need none. */
  operationPath(operationId: string): PanelMemberPath | undefined;
  /** A panel placed in one of this instance's members publishes into it, until the returned function ends that. */
  publish(member: string, publisher: Readonly<Ref<NestedPublisher>>): () => void;
  /**
   * Publishes what one member currently highlights (such as search matches or a directed path result) into
   * `pageContext.highlights`, until the returned disposer runs.
   */
  reportHighlight(member: string, highlight: Readonly<Ref<PageHighlight | null>>): () => void;
  /** The state an address or an open request may carry, for this instance. */
  deepLink(): Record<string, PanelDeepLinkStateValue>;
}

/**
 * One panel instance: everything belongs to it, so two instances of one panel share the declaration and its reads and
 * nothing else.
 */
/** A write's answer, with the targets its owner named when it prepared it; a target it left unnamed is not among them. */
export type PanelWriteResult = AppBridgeConfirmPanelOperationResult & {
  readonly named: readonly { readonly target: PanelObjectIdentity; readonly label: string }[];
};

/** The targets a preparation names: a batch's, by the labels its owner gave them. */
function namedTargets(confirmation: PanelHumanOperationPreparation["confirmation"]): PanelWriteResult["named"] {
  return confirmation.kind === "batch" ? confirmation.targets.objects : [];
}

export function createPanelInstance(manifest: PanelManifest, options: PanelInstanceOptions): PanelInstance {
  const state = createPanelState(manifest, options.initial);
  const objectListeners = new Set<(object: PanelObjectIdentity | null) => void>();
  const settledListeners = new Set<(link: PageDraftLink) => void>();
  const objectChanged = (object: PanelObjectIdentity | null) => {
    for (const listener of objectListeners) listener(object);
  };
  const registrations = shallowRef<readonly PanelProjectionRegistration[]>([]);
  /** Each member's own parameter values: those its component set and no panel state holds. */
  const own = shallowRef<Readonly<Record<string, Readonly<Record<string, RuntimeJsonValue>>>>>({});
  const prefix = options.memberPath ?? [];
  const segmentOf = options.segmentOf ?? ((member: string) => ({ member }));
  const memberPathOf = (member: string): PublisherPath => {
    const segment = segmentOf(member);
    const [first, ...rest] = prefix;
    return first ? [first, ...rest, segment] : [segment];
  };
  const operationIdOf = (member: string, name: string) => panelOperationId(memberPathOf(member).map((segment) => segment.member), name);
  /** A member's path as the platform needs it to find its operation: none for a fixed member of the opened panel. */
  const publisherPath = (member: string): PublisherPath | undefined => {
    const path = memberPathOf(member);
    return prefix.length || path.at(-1)!.selection ? path : undefined;
  };
  /** The panels placed in this instance's members, publishing into it. */
  const publishers = shallowReactive(new Map<string, Readonly<Ref<NestedPublisher>>>());
  function operationPath(operationId: string): PanelMemberPath | undefined {
    return operations.value.find((operation) => operation.id === operationId)?.memberPath;
  }
  async function writeOperation(operationId: string, invocation: PanelWriteInvocation) {
    // What the owner reports the write changed reaches the instance through the host's one refresh port, as an agent's
    // write does, and is read again from there; the receipt itself rereads nothing.
    const preparation = await options.operations.prepare(operationId, invocation, operationPath(operationId));
    return { ...await options.confirmOperation(preparation), named: namedTargets(preparation.confirmation) };
  }
  const commands = createPanelCommands(manifest, {
    state,
    invokeMember: (member, operation, input) => invoke(operationIdOf(member, operation), input),
    // Another member placed in a mode and an application entry are a later stage's; this release opens neither.
    open: (request) => Promise.reject(new Error(`This SDK release opens no ${request.mode === "entry" ? "application entry" : "member"} from a command`)),
    text: options.text,
  });
  const operations = computed<PanelOperationBinding[]>(() => [
    ...panelOperations(manifest, registrations.value, state, forms, commands, writeOperation,
      (operationId, call) => options.operations.read(operationId, call, operationPath(operationId)),
      (member, name) => ({ id: operationIdOf(member, name), memberPath: publisherPath(member) })),
    // A placed panel's operations are published under their own full paths and run by that panel.
    ...[...publishers.values()].flatMap((publisher) => publisher.value.operations),
  ]);
  /** A member's output: the state it binds takes the value. */
  function output(member: string, name: string, value: RuntimeJsonValue) {
    const declaration = manifest.members[member];
    if (!declaration) throw new Error(`The panel declares no member '${member}'`);
    const bound = declaration.outputs?.[name];
    if (bound) state.set(bound.state, value as never);
  }
  async function invoke(id: string, input?: Readonly<Record<string, unknown>>) {
    const found = operations.value.find((operation) => operation.id === id);
    if (!found) throw new Error(`The panel offers no operation '${id}'`);
    return found.invoke(input);
  }
  const forms = new PanelFormAdapters(options.reportDraftError);
  const draft = shallowRef<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const names = shallowReactive(new Map<string, string>());
  const highlights = shallowReactive(new Map<string, Readonly<Ref<PageHighlight | null>>>());
  const translate = options.translate ?? ((key: string) => key);
  const pageContext = computed<PageContext>(() => {
    const reportedHighlights = [
      ...[...highlights.values()].flatMap((entry) => {
        const value = entry.value;
        if (!value) return [];
        return [prefix.length ? { ...value, memberPath: prefix as PublisherPath } : value];
      }),
      ...[...publishers.values()].flatMap((publisher) => publisher.value.context?.highlights ?? []),
    ];
    return {
      pageKey: options.pageKey,
      url: options.url(),
      label: options.label(),
      selection: [
        // A placed panel's own selections say which placed panel they are, by its path.
        ...panelSelection(manifest, state.values.value, names, translate)
          .map((selected) => (prefix.length ? { ...selected, memberPath: prefix as PublisherPath } : selected)),
        ...[...publishers.values()].flatMap((publisher) => publisher.value.context?.selection ?? []),
      ],
      ...(reportedHighlights.length ? { highlights: reportedHighlights } : {}),
    };
  });
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
      if (!Object.keys(manifest.members).every((member) => registered.some((registration) => registration.slot === member))) return null;
      const formSlots = registered.filter((registration) => registration.takesDrafts).map((registration) => registration.slot);
      return forms.unclaimed(formSlots);
    }),
    projections: readonly(registrations),
    register(registration) {
      // In the declaration's slot order, whichever projection finished loading first: the operations an agent lists and
      // the header draws, and the forms a draft is offered to, keep the panel's own order.
      const order = Object.keys(manifest.members);
      registrations.value = [...registrations.value, registration]
        .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
      return () => {
        registrations.value = registrations.value.filter((item) => item !== registration);
      };
    },
    invoke,
    memberParam(member, name) {
      const declaration = manifest.members[member];
      if (!declaration) throw new Error(`The panel declares no member '${member}'`);
      const input = declaration.inputs?.[name];
      const outputBinding = declaration.outputs?.[name];
      if (input && !("state" in input)) {
        const fixed = "literal" in input ? input.literal : null;
        return { value: computed(() => fixed), set: () => { throw new Error(`Member '${member}' fixes '${name}'; it cannot be set`); } };
      }
      const bound = input?.state ?? outputBinding?.state;
      if (bound !== undefined) {
        return {
          value: computed(() => (state.values.value[bound] ?? null) as RuntimeJsonValue | null),
          set: (value) => state.set(bound, value as never),
        };
      }
      return {
        value: computed(() => own.value[member]?.[name] ?? null),
        set(value) {
          const kept = { ...own.value[member] };
          if (value === null) delete kept[name];
          else kept[name] = value;
          own.value = { ...own.value, [member]: kept };
        },
      };
    },
    ownParams: (member) => own.value[member] ?? {},
    output,
    async runHandler(handlerRef, call) {
      const result = await handlerFor(handlerRef).invoke(call);
      if (call.target?.kind === "object") objectChanged(call.target);
      return result;
    },
    describeOperation: (operationId) => options.operations.describe(operationId, operationPath(operationId)),
    readOperation: (operationId, call) => options.operations.read(operationId, call, operationPath(operationId)),
    uploadFile: (operationId, file) => options.operations.upload(operationId, file, operationPath(operationId)),
    writeOperation,
    objectChanged,
    letGo(removed) {
      const gone = (object: PanelObjectRef) =>
        removed.some(({ objectType, primaryKey }) => objectType === object.className && primaryKey === object.primaryKey);
      for (const [name, { type }] of Object.entries(manifest.state)) {
        const value = state.values.value[name];
        if (type.kind === "object") {
          const held = stateObject(value);
          if (held && gone(held)) state.set(name, null);
        } else if (type.kind === "list" && type.items.kind === "object") {
          const held = stateObjects(value);
          if (held.some(gone)) state.set(name, held.filter((object) => !gone(object)));
        }
      }
    },
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
    dirty: () => draft.value !== null || forms.dirty() || [...publishers.values()].some((publisher) => publisher.value.dirty()),
    memberPathOf,
    operationIdOf,
    operationPath,
    publish(member, publisher) {
      publishers.set(member, publisher);
      return () => {
        if (publishers.get(member) === publisher) publishers.delete(member);
      };
    },
    reportHighlight(member, highlight) {
      highlights.set(member, highlight);
      return () => {
        if (highlights.get(member) === highlight) highlights.delete(member);
      };
    },
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
