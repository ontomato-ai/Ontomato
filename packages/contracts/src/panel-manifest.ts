import { z } from "zod";
import { runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema } from "./form-fields";
import { pageDraftLinkSchema } from "./page-draft";
import { platformHasChildCollection, platformObjectTypes, platformOntologyLayers } from "./platform-object-types";

/*
 * What a panel's `panel.mjs` exports through `definePanel`: the state the panel keeps for one instance and the
 * projections it composes into slots, and nothing about how it is drawn (the HTML and the module own layout and
 * interaction). The SDK mounts the panel from this declaration, so a panel author never wires up page context, deep
 * links, draft dispatch or button execution by hand; the registry stores the declaration beside the panel's content,
 * and the graph reads it instead of the HTML.
 *
 * Operations a projection already defines — saving a form, running a task — are not declared here a second time: the
 * SDK derives them from the slot's projection binding and the component/client metadata, and describes them in this
 * file's `panelOperationSchema` shape. What the manifest adds is only the panel's own state and navigation operations.
 */

const key = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "Reserved key");

export const panelObjectIdentitySchema = z.object({
  objectType: key,
  primaryKey: z.string().min(1).max(1000),
}).strict();
export type PanelObjectIdentity = z.infer<typeof panelObjectIdentitySchema>;

/** A child's key is unique within its owner's parent record, regardless of the view that presents it. */
export const panelChildObjectIdentitySchema = z.object({
  parent: panelObjectIdentitySchema,
  primaryKey: panelObjectIdentitySchema.shape.primaryKey,
}).strict();
export type PanelChildObjectIdentity = z.infer<typeof panelChildObjectIdentitySchema>;

const undeclaredCollection = { path: ["collection"], message: "Undeclared child collection for this parent type" };

/** The owner reads a collection within a specific parent record. */
export const panelChildCollectionQuerySchema = z.object({
  parent: panelObjectIdentitySchema,
  collection: key,
}).strict().refine(({ parent, collection }) => platformHasChildCollection(parent.objectType, collection), undeclaredCollection);
export type PanelChildCollectionQuery = z.infer<typeof panelChildCollectionQuerySchema>;

/** A flat reference into the current panel's content.messages. */
export const panelMessageKeySchema = z.string().min(1);

const ontologyTypeId = z.string().min(1).max(200);
const ontologyObjectTypeSchema = z.object({ kind: z.literal("object"), objectType: ontologyTypeId }).strict();
export const ontologyObjectCollectionTypeSchema = ontologyObjectTypeSchema.extend({ kind: z.literal("objects") });
const ontologyScalarTypeSchema = z.object({
  kind: z.literal("scalar"), type: z.enum(["string", "number", "boolean", "date"]),
}).strict();

const childObjectType = z.object({
  kind: z.literal("child-object"), parentType: ontologyTypeId, collection: key,
}).strict();

const declaredChildCollection = ({ parentType, collection }: z.infer<typeof childObjectType>) =>
  platformHasChildCollection(parentType, collection);

export const ontologyChildObjectTypeSchema = childObjectType.refine(declaredChildCollection, undeclaredCollection);
export type OntologyChildObjectType = z.infer<typeof ontologyChildObjectTypeSchema>;

const explicitObjectUnionTypeSchema = z.object({
  kind: z.literal("object-union"),
  objectTypes: z.array(ontologyTypeId.refine((id) => Object.hasOwn(platformObjectTypes, id), "Undeclared platform object type")).nonempty(),
}).strict();

const layeredObjectUnionTypeSchema = z.object({
  kind: z.literal("object-union"),
  layers: z.array(z.enum(platformOntologyLayers)).nonempty(),
}).strict();

/** One selected object whose type is declared explicitly or belongs to one of the selected layers. */
export const ontologyObjectUnionTypeSchema = z.union([explicitObjectUnionTypeSchema, layeredObjectUnionTypeSchema]);
export type OntologyObjectUnionType = z.infer<typeof ontologyObjectUnionTypeSchema>;

/** Resolve layer selectors against the current type declarations, keeping the selector in the stored manifest. */
export function objectUnionTypes(field: OntologyObjectUnionType): readonly string[] {
  if ("objectTypes" in field) return field.objectTypes;
  return Object.entries(platformObjectTypes)
    .filter(([, { layer }]) => layer !== undefined && field.layers.includes(layer))
    .map(([id]) => id);
}

/** The vocabulary for consumers that bind only a single known object type or a scalar. */
export const singleOntologyParameterTypeSchema = z.discriminatedUnion("kind", [
  ontologyObjectTypeSchema, ontologyScalarTypeSchema,
]);

/** Projection ports may carry scalar values, object identities, child identities or an instance's checked collection. */
export const ontologyParameterTypeSchema = z.union([
  singleOntologyParameterTypeSchema,
  ontologyObjectUnionTypeSchema,
  ontologyChildObjectTypeSchema,
  ontologyObjectCollectionTypeSchema,
]);
export type OntologyParameterType = z.infer<typeof ontologyParameterTypeSchema>;

export function matchesObjectType(field: OntologyObjectUnionType | z.infer<typeof ontologyObjectTypeSchema>, className: string): boolean {
  return field.kind === "object" ? field.objectType === className : objectUnionTypes(field).includes(className);
}

/**
 * One field of a panel's own state. Two instances of the same panel keep separate values, so a selection made in one is
 * never seen by the other; a shared projection receives the state as an input value instead (overall design 3.2, 10.1).
 * The first object a panel shows comes from opening it (a deep link or an open request), never from the declaration: a
 * primary key in a shared panel would open every user's instance on the same object.
 */
const deepLink = z.boolean().default(false);
export const panelStateFieldSchema = z.union([
  ontologyObjectTypeSchema.extend({ deepLink }),
  explicitObjectUnionTypeSchema.extend({ deepLink }),
  layeredObjectUnionTypeSchema.extend({ deepLink }),
  childObjectType.extend({ deepLink }).refine(declaredChildCollection, undeclaredCollection),
  ontologyObjectCollectionTypeSchema.extend({ deepLink: z.literal(false).default(false) }),
  ontologyScalarTypeSchema.extend({ deepLink }),
]);
export type PanelStateField = z.infer<typeof panelStateFieldSchema>;

/** The state a panel declares: fields by name, each with its own type. */
export const panelStateSchema = z.record(key, panelStateFieldSchema);
export type PanelState = z.infer<typeof panelStateSchema>;

/** An object reference in panel state. */
export const panelObjectRefSchema = z.object({
  className: z.string().min(1).max(200),
  primaryKey: z.string().min(1).max(1000),
}).strict();

/** Values that can cross the address and deep-link state boundary. */
export const panelDeepLinkStateValueSchema = z.union([
  panelObjectRefSchema,
  panelChildObjectIdentitySchema,
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type PanelDeepLinkStateValue = z.infer<typeof panelDeepLinkStateValueSchema>;

/** Checked identities belong to the instance. The declared field supplies the object type of every member. */
export const panelObjectCollectionValueSchema = z.array(panelObjectRefSchema);
export const panelStateValueSchema = z.union([panelDeepLinkStateValueSchema, panelObjectCollectionValueSchema]);
export type PanelStateValue = z.infer<typeof panelStateValueSchema>;

/**
 * Where a slot's input value comes from: one field of this panel's state. A slot never reads another panel's state, and
 * an instance's own selection is what its slots see.
 */
export const panelStateRefSchema = z.object({ state: key }).strict();
export type PanelStateRef = z.infer<typeof panelStateRefSchema>;

/** A projection reads and edits one owner-declared field of a form in this same panel instance. */
export const panelFormFieldRefSchema = z.object({
  slot: key,
  /** JSON Pointer to a field, or to the owner-declared object-array when itemPath is set. */
  path: formFieldErrorSchema.shape.field,
  /** JSON Pointer within each row. Resolve it against the row's current index for edits, refreshes and errors. */
  itemPath: formFieldErrorSchema.shape.field.optional(),
}).strict();
export type PanelFormFieldRef = z.infer<typeof panelFormFieldRefSchema>;

const panelOperationInputRefSchema = z.union([
  panelStateRefSchema,
  z.object({ formField: panelFormFieldRefSchema.pick({ slot: true, path: true }) }).strict(),
]);

/** Values supplied by this instance. The owner operation's target still supplies the draft. */
export const panelReadOperationInputsSchema = z.object({
  parameters: z.union([
    panelOperationInputRefSchema,
    z.object({ fields: z.record(key, panelOperationInputRefSchema) }).strict(),
  ]),
  bindingId: panelOperationInputRefSchema.optional(),
}).strict();
export type PanelReadOperationInputs = z.infer<typeof panelReadOperationInputsSchema>;

/**
 * A projection placed in a slot. The slot carries the projection's ID and the values it is given; the projection's own
 * component, binding and display stay with the projection, and a panel that needs another presentation registers
 * another projection instead of overriding one here (overall design 3.2). Every slot the panel composes is declared,
 * drawn or not: the graph needs the whole set, and a form behind a collapsed section must reach the agent that fills it
 * (overall design 3.3). Whether a slot is drawn where is the HTML's and the module's business.
 */
export const panelSlotSchema = z
  .object({
    projectionId: z.string().min(1).max(200),
    /** Values passed to the projection's declared inputs, by parameter name, each from this panel's state. */
    inputs: z.record(key, panelStateRefSchema).default({}),
    /** Where each named projection output writes its value in this instance's declared state. */
    outputs: z.record(key, panelStateRefSchema).optional(),
    formField: panelFormFieldRefSchema.optional(),
    /** Input sources by operation name within this projection. A direct parameters source holds the whole object. */
    readOperationInputs: z.record(key, panelReadOperationInputsSchema).optional(),
  })
  .strict();
export type PanelSlot = z.infer<typeof panelSlotSchema>;

export const panelSlotsSchema = z.record(key, panelSlotSchema);
export type PanelSlots = z.infer<typeof panelSlotsSchema>;

/**
 * What an operation does, which decides who may invoke it and how: a form save keeps the draft's unsaved/save/discard
 * cycle, an action is an explicit business operation (run now, disable, delete), and a state change is presentation or
 * navigation whose only effect is a value in an instance (overall design 5.1, 5.2).
 */
export const panelOperationKindSchema = z.enum(["form.save", "action", "state"]);
export type PanelOperationKind = z.infer<typeof panelOperationKindSchema>;

/**
 * The object an operation acts on: a state field of the panel instance, so the reader's current selection is the
 * target, or the form draft's own target when the form creates an object.
 */
export const panelOperationTargetSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("state"), state: key }).strict(),
  z.object({ source: z.literal("draft"), slot: key }).strict(),
]);
export type PanelOperationTarget = z.infer<typeof panelOperationTargetSchema>;

/**
 * An operation as the agent and the header both receive it. `handlerRef` names an operation the SDK publishes; it is
 * never a URL, SQL or function source, so a described operation is one somebody registered (overall design 5.1). The
 * SDK derives `form.save` and `action` descriptions from a slot's projection binding plus the client and component
 * metadata; a `state` operation comes from the panel's own declaration below.
 */
export const panelOperationSchema = z
  .object({
    id: key,
    label: z.string().min(1).max(200),
    kind: panelOperationKindSchema,
    /** The parameters the operation takes, by name; a form save's parameters are the owner's form fields, read live. */
    inputSchema: z.record(key, ontologyParameterTypeSchema).default({}),
    /** Absent on a state operation: what it changes is the panel's own state, not an object. */
    target: panelOperationTargetSchema.optional(),
    /** The slot whose projection publishes this operation; absent on a state operation. */
    slot: key.optional(),
    handlerRef: z.string().min(1).max(300),
  })
  .strict()
  .superRefine((operation, ctx) => {
    if (operation.kind === "state") return;
    if (!operation.target)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: `Operation '${operation.id}' must name the object it acts on` });
    if (!operation.slot)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slot"], message: `Operation '${operation.id}' must name the slot that publishes it` });
  });
export type PanelOperation = z.infer<typeof panelOperationSchema>;

/** An existing record or the form's create target, using the operation's existing draft identity. */
export const panelFormTargetSchema = z.discriminatedUnion("kind", [
  panelObjectIdentitySchema.extend({ kind: z.literal("object") }),
  z.object({ kind: z.literal("draft"), id: z.string().min(1).max(200).optional() }).strict(),
]);
export type PanelFormTarget = z.infer<typeof panelFormTargetSchema>;

export const panelOperationCallSchema = z
  .object({
    /** The object the call acts on: an ontology reference, or a draft target that may not exist yet. */
    target: panelFormTargetSchema.nullable(),
    /** What the caller supplies, by the operation's `inputSchema`; a form save's is the owner's form values. */
    input: z.record(key, z.unknown()).default({}),
    /** A create from an existing draft link; the host verifies the artifact and records the new object under its owner. */
    draft: pageDraftLinkSchema.optional(),
  })
  .strict();
export type PanelOperationCall = z.infer<typeof panelOperationCallSchema>;

/**
 * The ID of an operation a projection publishes: the slot it sits in and the operation's own name, so two instances of
 * one panel and two panels using one projection describe the same operation the same way.
 */
export function panelOperationId(slot: string, operation: string) {
  return `${slot}.${operation}`;
}

/**
 * A state or navigation operation the panel declares itself: the effects it has are its own state, and it needs no
 * projection behind it.
 */
export const panelStateOperationSchema = z
  .object({
    id: key,
    labelKey: panelMessageKeySchema.max(200),
    kind: z.literal("state"),
    /** The fields it sets, by name, with the value each takes; a state operation writes nothing else. */
    sets: z.record(key, panelStateValueSchema).default({}),
  })
  .strict();
export type PanelStateOperation = z.infer<typeof panelStateOperationSchema>;

/**
 * What a panel declares. It is the SDK's whole source of truth about the panel's own state and composition: which
 * projections it contains and in which slot, what its state is, and which state changes it offers by name. The
 * operations its projections publish are derived, not repeated here.
 */
export const panelManifestSchema = z
  .object({
    state: panelStateSchema,
    slots: panelSlotsSchema,
    operations: z.array(panelStateOperationSchema).max(100),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const [slot, declaration] of Object.entries(manifest.slots)) {
      const form = declaration.formField;
      if (form && (form.slot === slot || !Object.hasOwn(manifest.slots, form.slot)))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", slot, "formField", "slot"], message: "A field port must reference another declared slot" });
      for (const [input, ref] of Object.entries(declaration.inputs)) {
        if (!Object.hasOwn(manifest.state, ref.state))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", slot, "inputs", input], message: `Input '${input}' reads undeclared state '${ref.state}'` });
      }
      for (const [output, ref] of Object.entries(declaration.outputs ?? {})) {
        if (!Object.hasOwn(manifest.state, ref.state))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", slot, "outputs", output], message: `Output '${output}' writes undeclared state '${ref.state}'` });
      }
      for (const [operation, { parameters, bindingId }] of Object.entries(declaration.readOperationInputs ?? {})) {
        const refs = "fields" in parameters
          ? Object.entries(parameters.fields).map(([name, ref]) => ({ path: ["parameters", "fields", name], ref }))
          : [{ path: ["parameters"], ref: parameters }];
        if (bindingId) refs.push({ path: ["bindingId"], ref: bindingId });
        for (const { path, ref } of refs) {
          const exists = "state" in ref ? Object.hasOwn(manifest.state, ref.state) : Object.hasOwn(manifest.slots, ref.formField.slot);
          if (!exists) ctx.addIssue({ code: z.ZodIssueCode.custom,
            path: ["slots", slot, "readOperationInputs", operation, ...path], message: "Input must reference declared state or a form slot" });
        }
      }
    }
    const ids = new Set<string>();
    for (const operation of manifest.operations) {
      if (ids.has(operation.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations"], message: `Duplicate operation '${operation.id}'` });
      ids.add(operation.id);
      for (const state of Object.keys(operation.sets)) {
        if (!Object.hasOwn(manifest.state, state))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", operation.id, "sets", state], message: `Operation '${operation.id}' sets undeclared state '${state}'` });
      }
    }
  });
export type PanelManifest = z.infer<typeof panelManifestSchema>;

/**
 * What a panel module exports: `definePanel` checks the declaration and hands it back with its defaults filled, so the
 * module stays plain ES and a slot's inputs are there whether or not the author wrote them. The registry reads the
 * manifest from the module; the host runs with that manifest alone and never the module text.
 */
export function definePanel(manifest: PanelManifest): PanelManifest {
  return panelManifestSchema.parse(manifest);
}

/**
 * A request to open one panel instance at a state: the application's panel use (its address and permission live on the
 * relation) and the deep-linkable state fields to restore. It is what an agent's `open` and a link both carry; a form
 * never travels here, only through the draft product (overall design 3.4).
 */
export const panelOpenRequestSchema = z
  .object({
    useId: z.string().min(1).max(200),
    state: z.record(key, panelDeepLinkStateValueSchema).default({}),
  })
  .strict();
export type PanelOpenRequest = z.infer<typeof panelOpenRequestSchema>;

export function matchesDirectPanelValue(type: z.infer<typeof singleOntologyParameterTypeSchema>, value: unknown): boolean {
  if (value === null) return true;
  if (type.kind === "object") {
    const ref = panelObjectRefSchema.safeParse(value);
    return ref.success && ref.data.className === type.objectType;
  }
  if (type.type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  return typeof value === type.type && (typeof value !== "number" || Number.isFinite(value));
}

export const directPanelStateFieldSchema = z.object({
  type: singleOntologyParameterTypeSchema,
  personal: z.literal(false).default(false),
  deepLink: z.boolean().default(false),
  external: z.boolean().default(false),
  default: panelStateValueSchema.optional(),
}).strict().superRefine((field, ctx) => {
  if (field.default === undefined || field.default === null) return;
  if (field.type.kind === "object" || !matchesDirectPanelValue(field.type, field.default))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["default"], message: "Invalid default value for the declared state type" });
});
export type DirectPanelStateField = z.infer<typeof directPanelStateFieldSchema>;

const literalValue = z.object({ literal: runtimeJsonValueSchema }).strict();
const memberInput = z.union([literalValue, panelStateRefSchema]);
const eventValue = z.union([literalValue, panelStateRefSchema, z.object({ event: z.literal(true) }).strict()]);
export const directPanelMemberSchema = z.object({
  target: z.object({ projectionId: key }).strict(),
  inputs: z.record(key, memberInput).optional(),
  outputs: z.record(key, panelStateRefSchema).optional(),
  params: z.object({ width: z.enum(["quarter", "third", "half", "twoThirds", "full", "auto"]) }).strict().optional(),
}).strict();
export type DirectPanelMember = z.infer<typeof directPanelMemberSchema>;

const directPanelEventSchema = z.object({
  on: z.object({ member: key, output: key }).strict(),
  do: z.union([
    z.object({ set: z.object({ state: key, value: eventValue }).strict() }).strict(),
    z.object({ invoke: z.object({ member: key, operation: key, inputs: z.record(key, eventValue) }).strict() }).strict(),
  ]),
}).strict();

export const directPanelManifestSchema = z.object({
  state: z.record(key, directPanelStateFieldSchema),
  members: z.record(key, directPanelMemberSchema),
  events: z.record(key, directPanelEventSchema),
}).strict().superRefine(({ state, members, events }, ctx) => {
  const requireName = (scope: Record<string, unknown>, name: string, path: string[]) => {
    if (!Object.hasOwn(scope, name))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `Undeclared reference '${name}'` });
  };
  for (const [member, declaration] of Object.entries(members)) {
    for (const [name, input] of Object.entries(declaration.inputs ?? {}))
      if ("state" in input) requireName(state, input.state, ["members", member, "inputs", name, "state"]);
    for (const [name, output] of Object.entries(declaration.outputs ?? {}))
      requireName(state, output.state, ["members", member, "outputs", name, "state"]);
  }
  for (const [name, event] of Object.entries(events)) {
    const path = ["events", name];
    requireName(members, event.on.member, [...path, "on", "member"]);
    if ("set" in event.do) {
      requireName(state, event.do.set.state, [...path, "do", "set", "state"]);
      if ("state" in event.do.set.value) requireName(state, event.do.set.value.state, [...path, "do", "set", "value", "state"]);
    } else {
      requireName(members, event.do.invoke.member, [...path, "do", "invoke", "member"]);
      for (const [input, ref] of Object.entries(event.do.invoke.inputs))
        if ("state" in ref) requireName(state, ref.state, [...path, "do", "invoke", "inputs", input, "state"]);
    }
  }
});
export type DirectPanelManifest = z.infer<typeof directPanelManifestSchema>;
