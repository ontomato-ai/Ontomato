import type { Component } from "vue";
import type { ComponentOperation } from "@ontomato/contracts/panel-projection";
import type { OntologyParameterType } from "@ontomato/contracts/panel-manifest";
import type { PanelReadResultId } from "@ontomato/contracts/platform-object-types";

/*
 * What a component of this SDK version offers a projection (overall design 3.1, 3.2): its identity, whether it presents
 * or controls, the ontology elements it may bind, the parameters it takes, the state it hands its host, and the
 * operations it publishes with the SDK client operation behind each.
 *
 * Type tools read a component's props and events; they cannot read what the component *means* — that a table bound to a
 * scheduled task reads it, that a button bound to `schedules.runNow` runs it. So the meaning is declared here, once,
 * beside the component it describes, and the generated catalogue and its document are read from these declarations. A
 * panel's projections take their ports from the catalogue: the operation a projection publishes and its `handlerRef` are
 * the ones declared here, never a name guessed from a label.
 */

/** What a component is for: something drawn, or something the reader operates. */
export type ComponentRole = "presentation" | "control";

export type ComponentClient = ComponentOperation;

export interface ComponentMetadata {
  /** The identity the catalogue and the graph use, e.g. `ScheduledTaskTable`. */
  readonly componentId: string;
  /** The public module an app imports it from, e.g. `@ontomato/sdk/form`. */
  readonly module: string;
  readonly exportName: string;
  readonly role: ComponentRole;
  /**
   * What the component means in one sentence, as its readers and an agent need it: what it draws or does, and what it
   * does not. The catalogue's description is this text; a second copy is not kept.
   */
  readonly meaning: string;
  /** Its side effects, when it has any: a save, a run, a request. Absent for a component that only displays. */
  readonly effects?: string;
  /**
   * The facts it reads from the platform, by the name a projection's `data` gives each: what results that read may
   * produce, and whether every placement must supply it. A component that reads no platform data omits this, or declares
   * an empty table to say so.
   */
  readonly data?: Readonly<Record<string, {
    readonly results: readonly PanelReadResultId[];
    readonly required: boolean;
  }>>;
  /** The ontology elements it may bind, as `Kind:id` or `Kind:*` when any of that kind does. */
  readonly bindsElement?: readonly string[];
  /** The parameters it takes, by name; a projection's `inputs` are these. */
  readonly inputs?: Readonly<Record<string, OntologyParameterType>>;
  /** The state it hands its host, by name: what the host's own template reads from it. */
  readonly outputs?: readonly string[];
  /** The operations it publishes: what a projection containing it offers, and what an agent may call. */
  readonly operations?: readonly ComponentClient[];
}

/**
 * Declares one component's metadata. The value is returned unchanged and read by the SDK's build, which generates the
 * catalogue and its document from every component this SDK version exports; a component without a declaration fails the
 * build rather than shipping undescribed.
 */
export function defineComponentMeta<const Meta extends ComponentMetadata>(meta: Meta): Meta {
  return meta;
}

/** One port of a component as its source declares it: a prop, an event or a slot, with its type and its comment. */
export interface ComponentPort {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

/**
 * A component's ports — its props, its events and its slots — read by the build from the component's own source, the
 * same reading its reference is written from, so what a directory shows of a component never differs from its code.
 */
export interface ComponentPorts {
  readonly props: readonly (ComponentPort & { readonly required: boolean; readonly default?: string })[];
  readonly events: readonly ComponentPort[];
  readonly slots: readonly ComponentPort[];
}

/** The catalogue a build writes as `components.json`: every declared component of one SDK version, with its ports. */
export interface ComponentCatalogue {
  readonly version: string;
  readonly components: readonly (ComponentMetadata & { readonly ports: ComponentPorts })[];
}

/** A component the catalogue describes, resolved back to the export a page imports. */
export interface DeclaredComponent {
  readonly metadata: ComponentMetadata;
  readonly component: Component;
}
