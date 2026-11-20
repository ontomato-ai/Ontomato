import { z } from "zod";
import { runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema } from "./form-fields";
import { pageDraftLinkSchema } from "./page-draft";
import { APPLICATION_PANEL_USE, PRODUCT_PANEL, platformHasChildCollection, platformObjectTypes, platformOntologyLayers } from "./platform-object-types";

/* The registered manifest describes a panel instance's state, placements, ports and events. Resource owners
 * describe their own operations. A frame and a direct instance consume the same registered declaration. */

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
export const panelListTypeSchema = z.object({ kind: z.literal("list"), items: ontologyObjectTypeSchema }).strict();
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
  panelListTypeSchema,
]);
export type OntologyParameterType = z.infer<typeof ontologyParameterTypeSchema>;

export function matchesObjectType(field: OntologyObjectUnionType | z.infer<typeof ontologyObjectTypeSchema>, className: string): boolean {
  return field.kind === "object" ? field.objectType === className : objectUnionTypes(field).includes(className);
}

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
 * What an operation does, which decides who may invoke it and how: a form save keeps the draft's unsaved/save/discard
 * cycle, an action is an explicit business operation (run now, disable, delete), and a state change is presentation or
 * navigation whose only effect is a value in an instance (overall design 5.1, 5.2).
 */
export const panelOperationKindSchema = z.enum(["form.save", "action", "state"]);
export type PanelOperationKind = z.infer<typeof panelOperationKindSchema>;

/**
 * An operation targets the instance's selected object or checked object list, or a form's draft target.
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

/** Theme variable names and values are validated by the deployment's token owner. */
export const panelThemeOverridesSchema = z.object({
  light: z.record(z.string()).optional(),
  dark: z.record(z.string()).optional(),
}).strict();
export type PanelThemeOverrides = z.infer<typeof panelThemeOverridesSchema>;

export const panelFixedMemberTargetSchema = z.union([
  z.object({ projectionId: key }).strict(),
  z.object({ panelId: key }).strict(),
]);
export type PanelFixedMemberTarget = z.infer<typeof panelFixedMemberTargetSchema>;

const panelIdCandidates = z.object({ panelIds: z.array(key).nonempty() }).strict();
const objectDetailCandidates = z.object({ rule: z.literal("objectDetail") }).strict();
export const panelPlacementCandidatesSchema = z.union([
  panelIdCandidates, objectDetailCandidates, z.object({ rule: z.literal("catalogSelection") }).strict(),
]);
export const panelMemberTargetSchema = z.union([
  panelFixedMemberTargetSchema,
  z.object({ fromState: key, candidates: z.union([panelIdCandidates, objectDetailCandidates]) }).strict(),
  z.object({ fromPlatform: z.literal("currentEntry"), candidates: z.object({ rule: z.literal("applicationEntry") }).strict() }).strict(),
]);
export type PanelMemberTarget = z.infer<typeof panelMemberTargetSchema>;

const literalValue = z.object({ literal: runtimeJsonValueSchema }).strict();
const itemValue = z.object({ item: z.literal(true) }).strict();
export const panelMemberInputSchema = z.union([literalValue, panelStateRefSchema, itemValue]);
export type PanelMemberInput = z.infer<typeof panelMemberInputSchema>;
const placementPorts = {
  inputs: z.record(key, panelMemberInputSchema).optional(),
  outputs: z.record(key, panelStateRefSchema).optional(),
  theme: panelThemeOverridesSchema.optional(),
};
export const panelPlacementSchema = z.object({
  id: key,
  target: panelFixedMemberTargetSchema,
  ...placementPorts,
}).strict();
export type PanelPlacement = z.infer<typeof panelPlacementSchema>;

export const panelMemberPathSegmentSchema = z.object({
  member: key,
  itemKey: z.union([key, z.number().int().nonnegative(), panelObjectRefSchema]).optional(),
  selection: z.union([
    z.object({ stateValue: runtimeJsonValueSchema, target: z.object({ panelId: key }).strict() }).strict(),
    z.object({ placement: panelPlacementSchema.pick({ id: true, target: true }) }).strict(),
  ]).optional(),
}).strict();
export const panelMemberPathSchema = z.array(panelMemberPathSegmentSchema);
export type PanelMemberPath = z.infer<typeof panelMemberPathSchema>;

export const panelPlacementTypeSchema = z.object({
  kind: z.literal("placement"), candidates: panelPlacementCandidatesSchema,
}).strict();

export const directPanelPortTypeSchema = z.union([ontologyParameterTypeSchema, panelPlacementTypeSchema]);
export type DirectPanelPortType = z.infer<typeof directPanelPortTypeSchema>;

/** Shapes reserved for the owners of a sub-object position and a live query selection. */
export const panelLocationTypeSchema = z.object({
  kind: z.literal("location"), objectType: key, positionType: key,
}).strict();
export const panelObjectSetTypeSchema = z.object({ kind: z.literal("object-set"), objectType: key }).strict();

export function matchesDirectPanelValue(type: DirectPanelPortType, value: unknown): boolean {
  if (value === null) return true;
  switch (type.kind) {
    case "object":
    case "object-union": {
      const ref = panelObjectRefSchema.safeParse(value);
      return ref.success && matchesObjectType(type, ref.data.className);
    }
    case "child-object": {
      const ref = panelChildObjectIdentitySchema.safeParse(value);
      return ref.success && ref.data.parent.objectType === type.parentType;
    }
    case "list":
      return Array.isArray(value) && value.every(item => item !== null && matchesDirectPanelValue(type.items, item));
    case "placement": {
      const placement = panelPlacementSchema.safeParse(value);
      if (!placement.success) return false;
      if ("rule" in type.candidates) return true; // Dynamic candidates are resolved by their trusted owner.
      return "panelId" in placement.data.target && type.candidates.panelIds.includes(placement.data.target.panelId);
    }
    case "scalar":
      if (type.type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
      return typeof value === type.type && (typeof value !== "number" || Number.isFinite(value));
  }
}

/** A connection is valid when every value of its source type can go into the exposed target field. */
export function panelPortAccepts(target: DirectPanelPortType, source: DirectPanelPortType): boolean {
  if (target.kind === "object" || target.kind === "object-union") {
    if (source.kind === "object") return matchesObjectType(target, source.objectType);
    return source.kind === "object-union" && objectUnionTypes(source).every(type => matchesObjectType(target, type));
  }
  if (target.kind === "scalar") return source.kind === "scalar" && target.type === source.type;
  if (target.kind === "child-object")
    return source.kind === "child-object" && target.parentType === source.parentType && target.collection === source.collection;
  if (target.kind === "list") return source.kind === "list" && panelPortAccepts(target.items, source.items);
  if (source.kind !== "placement") return false;
  const allowed = target.candidates;
  const offered = source.candidates;
  if ("rule" in allowed) return "rule" in offered && allowed.rule === offered.rule;
  return "panelIds" in offered && offered.panelIds.every(id => allowed.panelIds.includes(id));
}

export const panelStateFieldSchema = z.object({
  type: directPanelPortTypeSchema,
  personal: z.boolean().default(false),
  deepLink: z.boolean().default(false),
  external: z.boolean().default(false),
  default: runtimeJsonValueSchema.optional(),
}).strict().superRefine((field, ctx) => {
  if (field.type.kind === "list" && field.deepLink)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deepLink"], message: "Object lists are instance state" });
  if (field.default !== undefined && (!matchesDirectPanelValue(field.type, field.default)
    || field.default !== null && ["object", "object-union", "child-object"].includes(field.type.kind))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["default"], message: "Invalid default value for the declared state type" });
  }
});
export type PanelStateField = z.infer<typeof panelStateFieldSchema>;
export const panelStateSchema = z.record(key, panelStateFieldSchema);
export type PanelState = z.infer<typeof panelStateSchema>;
export const directPanelStateFieldSchema = panelStateFieldSchema;
export type DirectPanelStateField = PanelStateField;

export const panelMemberSchema = z.object({
  target: panelMemberTargetSchema,
  ...placementPorts,
  formField: panelFormFieldRefSchema.optional(),
  readOperationInputs: z.record(key, panelReadOperationInputsSchema).optional(),
}).strict();
export type PanelMember = z.infer<typeof panelMemberSchema>;

const eventPayload = z.object({ event: z.literal(true) }).strict();
export const panelEventValueSchema = z.union([panelMemberInputSchema, eventPayload]);
const eventInputs = z.record(key, panelEventValueSchema);
const openMember = z.object({
  mode: z.enum(["replace", "drawer", "dialog"]),
  member: key,
  inputs: eventInputs.optional(),
}).strict();
const openEntry = z.object({
  mode: z.literal("entry"),
  entry: z.union([
    z.object({ literal: panelObjectRefSchema.extend({ className: z.literal(APPLICATION_PANEL_USE) }) }).strict(),
    panelStateRefSchema, itemValue, eventPayload,
  ]),
  inputs: eventInputs.optional(),
}).strict();
export const panelEventSchema = z.object({
  on: z.object({ member: key, output: key }).strict().optional(),
  labelKey: panelMessageKeySchema.optional(),
  do: z.union([
    z.object({ set: z.object({ fields: eventInputs.refine(fields => Object.keys(fields).length > 0, "Set at least one state field") }).strict() }).strict(),
    z.object({ invoke: z.object({ member: key, operation: key, inputs: eventInputs }).strict() }).strict(),
    z.object({ open: z.union([openMember, openEntry]) }).strict(),
  ]),
}).strict();
export type PanelEvent = z.infer<typeof panelEventSchema>;

export const panelManifestSchema = z.object({
  state: panelStateSchema,
  members: z.record(key, panelMemberSchema),
  events: z.record(key, panelEventSchema),
}).strict().superRefine(({ state, members, events }, ctx) => {
  function issue(path: string[], message: string) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  }
  function requireName(scope: Record<string, unknown>, name: string, path: string[]) {
    if (!Object.hasOwn(scope, name)) issue(path, `Undeclared reference '${name}'`);
  }
  for (const [member, declaration] of Object.entries(members)) {
    const path = ["members", member];
    if ("fromState" in declaration.target) {
      const { fromState, candidates } = declaration.target;
      const sourcePath = [...path, "target", "fromState"];
      if (!Object.hasOwn(state, fromState)) requireName(state, fromState, sourcePath);
      else {
        const type = state[fromState].type;
        if ("rule" in candidates ? type.kind !== "object" && type.kind !== "object-union"
          : type.kind !== "object" || type.objectType !== PRODUCT_PANEL)
          issue(sourcePath, "The state type does not match this placement's candidates");
      }
    }
    for (const [name, input] of Object.entries(declaration.inputs ?? {}))
      if ("state" in input) requireName(state, input.state, [...path, "inputs", name, "state"]);
    for (const [name, output] of Object.entries(declaration.outputs ?? {}))
      requireName(state, output.state, [...path, "outputs", name, "state"]);
    if (declaration.formField) {
      const { slot } = declaration.formField;
      if (slot === member) issue([...path, "formField", "slot"], "A field port must reference another member");
      else requireName(members, slot, [...path, "formField", "slot"]);
    }
    for (const [operation, { parameters, bindingId }] of Object.entries(declaration.readOperationInputs ?? {})) {
      const refs = "fields" in parameters
        ? Object.entries(parameters.fields).map(([name, ref]) => ({ path: ["parameters", "fields", name], ref }))
        : [{ path: ["parameters"], ref: parameters }];
      if (bindingId) refs.push({ path: ["bindingId"], ref: bindingId });
      for (const { path: parameter, ref } of refs) {
        const target = [...path, "readOperationInputs", operation, ...parameter];
        if ("state" in ref) requireName(state, ref.state, [...target, "state"]);
        else requireName(members, ref.formField.slot, [...target, "formField", "slot"]);
      }
    }
  }
  for (const [name, event] of Object.entries(events)) {
    const path = ["events", name];
    if (event.on) requireName(members, event.on.member, [...path, "on", "member"]);
    else if (!event.labelKey) issue(path, "Declare an output trigger or a label for explicit invocation");

    const action = event.do;
    const [operation, values] = "set" in action ? ["set", action.set.fields] as const
      : "invoke" in action ? ["invoke", action.invoke.inputs] as const
      : ["open", action.open.inputs ?? {}] as const;
    if ("invoke" in action) requireName(members, action.invoke.member, [...path, "do", "invoke", "member"]);
    if ("open" in action && "member" in action.open) requireName(members, action.open.member, [...path, "do", "open", "member"]);
    if ("open" in action && action.open.mode === "entry") {
      const entry = action.open.entry;
      if ("state" in entry) requireName(state, entry.state, [...path, "do", "open", "entry", "state"]);
      if ("event" in entry && (!event.on || event.labelKey))
        issue([...path, "do", "open", "entry"], "An event value requires an output-only trigger");
    }
    for (const [field, value] of Object.entries(values)) {
      const valuePath = [...path, "do", operation, operation === "set" ? "fields" : "inputs", field];
      if (operation === "set") requireName(state, field, valuePath);
      if ("state" in value) requireName(state, value.state, [...valuePath, "state"]);
      if (operation === "set" && Object.hasOwn(state, field)) {
        const target = state[field].type;
        if ("literal" in value && !matchesDirectPanelValue(target, value.literal))
          issue([...valuePath, "literal"], "The value does not match the target state type");
        if ("state" in value && Object.hasOwn(state, value.state) && !panelPortAccepts(target, state[value.state].type))
          issue([...valuePath, "state"], "The source state type does not match the target state type");
      }
      if ("event" in value && (!event.on || event.labelKey))
        issue([...valuePath, "event"], "An event value requires an output-only trigger");
    }
  }
});
export type PanelManifest = z.infer<typeof panelManifestSchema>;

export const directPanelManifestSchema = panelManifestSchema;
export type DirectPanelManifest = PanelManifest;

export function definePanel(manifest: z.input<typeof panelManifestSchema>): PanelManifest {
  return panelManifestSchema.parse(manifest);
}
