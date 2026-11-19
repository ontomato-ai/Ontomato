import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelFormTargetSchema, type PanelFormTarget, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import {
  panelFormSaveInputSchema,
  type PanelFormDescription,
  type PanelFormRequest,
  type PanelFormSaveInput,
} from "@ontomato/contracts/panel-projection";
import { registerHandler, type RegisteredHandler } from "./handlers";
import type { ProductProjection } from "@ontomato/contracts/product-panels";

/*
 * How the SDK reads and writes one platform object type (overall design 3.2): a projection binds
 * `PlatformObjectType:platform:ScheduledTask`, and this registry says what reading one, listing them, reading the owner's
 * form for one and saving it mean for that type. It sits beside the handler registry and for the same reason: a component
 * is generic, and the type it is bound to decides which client answers.
 *
 * Only the types this step's panels use are registered. A binding to a type this version has not registered fails
 * visibly; it never falls back to another read.
 */

/** Half-open character range `[start, end)` in a plain text string to highlight; components escape all text. */
export interface TextHighlightRange {
  readonly start: number;
  readonly end: number;
}

/** Semantic tone for a status tag rendered by a list or summary. */
export type PlatformFieldTone = "default" | "info" | "success" | "warning" | "danger";

/** Clickable reference to another ontology object carried by a field, never constructed from label text. */
export interface PlatformFieldReference {
  readonly className: string;
  readonly primaryKey: string;
  readonly label: string;
}

/** One object of a registered platform type, as its owner's list, query and read return it. */
export interface PlatformObjectRecord {
  /** The primary key the object's own service uses, as text. */
  primaryKey: string;
  /** What a reader recognises it by, in one line. */
  label: string;
  /** Optional secondary line under the label (for example a description or highlighted excerpt). */
  subtitle?: string;
  /** What a summary or list column may show: the owner's own fields, by name, as text. */
  fields: Readonly<Record<string, string>>;
  /** Optional semantic tones by field name, used when a field renders as a status tag. */
  tones?: Readonly<Record<string, PlatformFieldTone>>;
  /** Optional tag lists by field name, rendered as tags. */
  tags?: Readonly<Record<string, readonly string[]>>;
  /** Optional clickable object references by field name, emitted through the navigate port. */
  references?: Readonly<Record<string, PlatformFieldReference>>;
  /** Optional highlight ranges by field name (or `"label"` / `"subtitle"`), half-open `[start, end)`. */
  highlights?: Readonly<Record<string, readonly TextHighlightRange[]>>;
}

/** Pagination input passed to a resource adapter's `query` port (offset/limit or cursor). */
export interface PlatformObjectQueryPage {
  readonly offset?: number;
  readonly limit: number;
  readonly cursor?: string;
}

/** Search, filter and paging parameters handed to a resource adapter; the adapter owns all query semantics. */
export interface PlatformObjectQuery {
  readonly search?: string;
  readonly filters?: Readonly<Record<string, string>>;
  readonly page?: PlatformObjectQueryPage;
}

/** One option of a filter facet, with an optional count computed under the current search/query. */
export interface PlatformObjectFacetOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
}

/** One filter facet returned by a resource adapter's `query` port. */
export interface PlatformObjectFacet {
  readonly key: string;
  readonly label: string;
  readonly options: readonly PlatformObjectFacetOption[];
}

/** Result of a resource adapter's `query` port: matching records, owner total and optional facets. */
export interface PlatformObjectQueryResult {
  readonly items: readonly PlatformObjectRecord[];
  /** Total matching records from the owner/adapter, never substituted with the current page size. */
  readonly total: number;
  readonly facets?: readonly PlatformObjectFacet[];
  readonly nextCursor?: string;
}

/**
 * An owner's refusal of a write or of an incoming draft, as a generic form shows it: the owner's own reason, and the
 * message for each form field the owner named — by the field's JSON Pointer path (`/executionUserId`). A refusal that names no field (somebody else changed
 * the object first, say) has none.
 */
export class PlatformObjectRefusal extends Error {
  constructor(
    message: string,
    readonly fields: Readonly<Record<string, string>>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PlatformObjectRefusal";
  }
}

/*
 * ---- Resource adapters (M1 typed forms) ----
 *
 * What a resource adapter of the SDK gives for one platform object type: the reads a list, a summary and a graph need,
 * the owner's typed form and the choices a reference field offers. A graph's edges are the records of their own type
 * (a relationship), whose endpoints the projection's `graph` declaration names by pointer into the record's fields. An adapter is written once per type (`resources/`), receives the frame's request path when the panel
 * mounts, and sends exactly the requests `contracts/panel-client-requests.ts` declares for its binding; nothing in it
 * decides a field, a default, a permission or a valid value — the owner answers all of those.
 */

/**
 * The request path an adapter sends its owner's requests through: the frame's own, over the bridge, with the reader's
 * credential (or the preview's trusted context). `service` is `""` for the Node API and `"/data-query"` for the data
 * engine, as the frame's request declarations name them; the path is the one inside that service. The response is the
 * owner's as it is: an adapter reads its status and body itself.
 */
export interface PlatformRequests {
  request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>, service: "" | "/data-query"): Promise<Response>;
}

/**
 * The owner's typed form for one type (design 2.2): one description and one save, by the contracts' `PanelFormRequest`,
 * `PanelFormDescription` and `PanelFormSaveInput`. The values are the owner's JSON value shape — nested objects, arrays,
 * `false` and `null` as they are — and field paths are JSON Pointers into them.
 */
export interface PlatformObjectForms {
  /**
   * Asks the owner for the form of a target: `{target, changedField: null}` opens it (an existing object, or the create
   * target with the owner's defaults); `{target, values, changedField: "/path"}` asks again after a field the description
   * marks `refreshOnChange` changed; `{target, values, changedField: null}` checks a complete incoming draft and returns
   * it normalised, without writing. An owner that refuses the values throws a `PlatformObjectRefusal` naming each field
   * by its path — a draft so refused is refused whole.
   */
  describe(request: PanelFormRequest): Promise<PanelFormDescription>;
  /**
   * Writes through the owner's own request: an `object` target updates it, a `draft` target creates one. `revision` is
   * passed back exactly as the description gave it (the scheduled tasks') and absent where the owner has none (agent
   * definitions). The result is the object as saved; for a create, its real primary key, which the panel selects next.
   * A refusal throws a `PlatformObjectRefusal` with the owner's reason and its field errors by path.
   */
  save(target: PanelFormTarget, input: PanelFormSaveInput): Promise<PlatformObjectRecord>;
}

/**
 * One choice a reference field offers. `value` is what the form field holds when it is chosen — a key (a model's
 * `provider/model-id`, a UUID, a class name) or the owner's whole value (a skill's complete `RuntimeSkillRef`), never a
 * shortened stand-in; `primaryKey` is the choice's identity, by which a held value is matched to it.
 */
export interface PlatformObjectOption {
  primaryKey: string;
  value: RuntimeJsonValue;
  label: string;
  description?: string;
  /**
   * Present when the choice cannot be chosen now, with the owner's reason: a value already held that is no longer
   * offered (a removed skill, a disabled user) stays listed this way rather than vanishing.
   */
  unavailable?: { reason: string };
}

/** The choices of one reference type, as its owner offers them to the reader. */
export interface PlatformObjectOptions {
  /** The choices offered now, in the owner's order; `keyword` and `page` reach owners that search and page. */
  list(query: { keyword?: string; page?: { number: number; size: number } }): Promise<{
    options: readonly PlatformObjectOption[];
    /** The number of choices the owner has for this query, where it pages. */
    total?: number;
  }>;
  /**
   * The values a field holds now, as choices — one per value, in the same order: each with its label, and those no
   * longer offered marked unavailable with the owner's reason (the execution user's `selected`, a skill gone from the
   * catalogue).
   */
  resolve(values: readonly RuntimeJsonValue[]): Promise<readonly PlatformObjectOption[]>;
}

/** Full object identity carried by graph nodes, selections and neighbor queries. */
export interface PlatformObjectRef {
  readonly className: string;
  readonly primaryKey: string;
}

/** Per-type or per-relation-kind read outcome reported by a graph source; never collapsed into an empty graph. */
export type PlatformGraphStatus = "ok" | "refused" | "failed" | "unavailable";

/** One node in a graph projection (instance mode). */
export interface PlatformGraphNode {
  readonly className: string;
  readonly primaryKey: string;
  readonly label: string;
  /** Optional layer key (for example `"fact" | "capability" | "governance" | "product"`). */
  readonly layer?: string;
  readonly detail?: string;
}

/** One edge in a graph projection (instance mode). */
export interface PlatformGraphEdge {
  readonly id: string;
  readonly relationKind: string;
  /** Optional display label or message key; falls back to schema/platform relation labelKey when omitted. */
  readonly label?: string;
  readonly from: PlatformObjectRef;
  readonly to: PlatformObjectRef;
  readonly direction: "outgoing" | "incoming";
  readonly derived?: boolean;
}

/** Outcome of querying one relation kind for a node's neighbors. */
export interface PlatformGraphRelationStatus {
  readonly relationKind: string;
  readonly status: PlatformGraphStatus;
  readonly edgeCount: number;
  readonly reason?: string;
}

/** One object type declared in a graph's type-mode schema. */
export interface PlatformGraphTypeSpec {
  readonly id: string;
  readonly layer?: string;
  readonly labelKey?: string;
  readonly label?: string;
}

/** One relation kind declared in a graph's type-mode schema. */
export interface PlatformGraphRelationKindSpec {
  readonly id: string;
  readonly from: string;
  readonly to: string | readonly string[];
  readonly labelKey?: string;
  readonly label?: string;
  readonly derived?: boolean;
}

/** Schema returned for type mode: ordered layers (optional), types and relation kinds. */
export interface PlatformGraphSchema {
  readonly layers?: readonly string[];
  readonly objectTypes: readonly PlatformGraphTypeSpec[];
  readonly relationKinds: readonly PlatformGraphRelationKindSpec[];
}

/** Readable count and access status for one object type in type mode. */
export interface PlatformGraphTypeCount {
  readonly type: string;
  readonly layer?: string;
  readonly status: PlatformGraphStatus;
  readonly count?: number;
  readonly reason?: string;
}

/** Request to expand one hop of neighbors around a node. */
export interface PlatformGraphNeighborsQuery {
  readonly node: PlatformObjectRef;
  readonly relationKinds?: readonly string[];
  readonly layers?: readonly string[];
}

/** Result of expanding one hop of neighbors around a node. */
export interface PlatformGraphNeighborsResult {
  readonly node: PlatformGraphNode;
  readonly neighbors: readonly PlatformGraphNode[];
  readonly edges: readonly PlatformGraphEdge[];
  readonly relations: readonly PlatformGraphRelationStatus[];
}

/** Graph source port implemented by a resource adapter bound to a graph projection (M3 capability map, M4 instance graph). */
export interface PlatformObjectGraph {
  /** Schema of types and relation kinds for type mode (optional for instance-only graphs such as M4). */
  schema?(): Promise<PlatformGraphSchema>;
  /** Per-type readable counts and access status for type mode (optional for instance-only graphs). */
  counts?(): Promise<readonly PlatformGraphTypeCount[]>;
  /** Default starting node for instance mode when no explicit `start` input is provided. */
  start?(): Promise<PlatformGraphNode | null>;
  /** One-hop neighbors, edges and per-relation-kind outcome statuses for one node. */
  neighbors(query: PlatformGraphNeighborsQuery): Promise<PlatformGraphNeighborsResult>;
}

/**
 * Everything the SDK reads and writes for one platform object type. A part a type does not have is absent, and a
 * projection that needs it fails visibly when it is drawn — a form bound to a type without `forms`, a picker bound to one
 * without `options` — rather than falling back to another read.
 */
export interface PlatformObjectAdapter {
  /** The type as a projection's binding names it: `platform:AgentDefinition`. */
  objectType: string;
  list?(): Promise<readonly PlatformObjectRecord[]>;
  query?(query: PlatformObjectQuery): Promise<PlatformObjectQueryResult>;
  read?(primaryKey: string): Promise<PlatformObjectRecord>;
  forms?: PlatformObjectForms;
  options?: PlatformObjectOptions;
  graph?: PlatformObjectGraph;
}

/**
 * How a resource module provides its adapter: given the frame's request path when a panel mounts. Two types whose owner
 * answers both from one response (classes and relationships, from one metadata read) are written in one module that
 * returns both adapters over that one read.
 */
export type PlatformObjectAdapterFactory = (requests: PlatformRequests) => readonly PlatformObjectAdapter[];

/** How a resource module provides one platform operation's handler (`schedules.runNow`), given the frame's request path. */
export type PlatformOperationFactory = (requests: PlatformRequests) => RegisteredHandler;

/**
 * The resource modules of this SDK version, by the binding that reaches them (`PlatformObjectType:platform:Skill`,
 * `PlatformOperation:schedules.runNow`). Each is fetched the first time a projection binds it, so a panel downloads
 * the clients — and the owner schemas they parse with — of the resources it shows and no others.
 */
export interface PlatformResources {
  objects: Readonly<Record<string, () => Promise<PlatformObjectAdapterFactory>>>;
  operations: Readonly<Record<string, () => Promise<PlatformOperationFactory>>>;
  /**
   * The clients a component reads its own resource through, by the component a projection draws (`MetricChart`'s chart
   * source): the module registers its client with the frame's request path.
   */
  components: Readonly<Record<string, () => Promise<(requests: PlatformRequests) => void>>>;
}

/**
 * What a frame calls before a projection registers its ports: every resource its record binds — its binding and, for a
 * graph, its edges' — and the client its component reads through, fetched and registered with the frame's request
 * path, once per module. A binding this version has
 * no module for is left to fail where it is used.
 */
export function platformResourceLoader(requests: PlatformRequests, resources: PlatformResources) {
  const loaded = new Map<() => Promise<unknown>, Promise<void>>();
  const once = <Factory>(load: (() => Promise<Factory>) | undefined, register: (factory: Factory) => void) => {
    if (!load) return Promise.resolve();
    let pending = loaded.get(load);
    if (!pending) {
      pending = load().then(register);
      loaded.set(load, pending);
    }
    return pending;
  };
  return async (projection: Pick<ProductProjection, "componentId" | "binding" | "graph">): Promise<void> => {
    const bindings = [projection.binding, ...(projection.graph ? [projection.graph.edges.binding] : [])];
    await Promise.all([
      ...bindings.map((binding) => binding.kind === "PlatformOperation"
        ? once(resources.operations[binding.id], (factory) => registerHandler(factory(requests)))
        : once(resources.objects[binding.id], (factory) => factory(requests).forEach(registerPlatformObjectAdapter))),
      once(resources.components[projection.componentId], (register) => register(requests)),
    ]);
  };
}

const adapters = new Map<string, PlatformObjectAdapter>();

/**
 * Registers one type's adapter and, when it has a form, the type's own save operation — `<type>.save` — which a
 * person's header button and an agent's call both reach with the form's target and `{values, revision?}`. One type,
 * one adapter, one save: registering a type twice fails.
 */
export function registerPlatformObjectAdapter(adapter: PlatformObjectAdapter): void {
  if (adapters.has(adapter.objectType))
    throw new Error(`Platform object '${adapter.objectType}' is already registered`);
  adapters.set(adapter.objectType, adapter);
  const forms = adapter.forms;
  if (!forms) return;
  registerHandler({
    handlerRef: `${adapter.objectType}.save`,
    // The call arrives from a person's click or an agent's operation: its target and input are checked here, once.
    invoke: ({ target, input }) => forms.save(panelFormTargetSchema.parse(target), panelFormSaveInputSchema.parse(input)),
  });
}

/** The adapter that answers for one binding's type. */
export function platformObjectAdapter(objectType: string): PlatformObjectAdapter {
  const found = adapters.get(objectType);
  if (!found) throw new Error(`This SDK version reads no platform object '${objectType}'`);
  return found;
}

/** The types this version reads: what a projection may bind. */
export function registeredPlatformObjects(): readonly string[] {
  return [...adapters.keys()];
}

/** One part of a type's adapter, or a visible failure naming the type and the part it lacks. */
export function adapterPart<Part extends "list" | "query" | "read" | "forms" | "options" | "graph">(
  objectType: string,
  part: Part,
): NonNullable<PlatformObjectAdapter[Part]> {
  const found = platformObjectAdapter(objectType)[part];
  if (!found) throw new Error(`Platform object '${objectType}' has no ${part}`);
  return found as NonNullable<PlatformObjectAdapter[Part]>;
}

/** The primary key a projection's input value names, or null when nothing is selected. */
export function selectedKey(value: PanelStateValue | undefined): string | null {
  return value && typeof value === "object" ? value.primaryKey : null;
}
