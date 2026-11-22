import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema } from "./form-fields";
import { pageDraftLinkSchema } from "./page-draft";
import {
  panelMemberItemKeySchema,
  panelObjectRefSchema,
  type PanelMemberItemKey,
  type PanelObjectRef,
} from "./panel-object-ref";
import { APPLICATION_PANEL_USE, PRODUCT_PANEL, PRODUCT_PROJECTION, platformHasChildCollection, platformObjectTypes, platformOntologyLayers } from "./platform-object-types";

export {
  panelMemberItemKeySchema,
  panelObjectRefSchema,
  type PanelMemberItemKey,
  type PanelObjectRef,
};

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
  objectTypes: z.array(ontologyTypeId.refine((id) => Object.hasOwn(platformObjectTypes, id), "Undeclared platform object type"))
    .nonempty(),
}).strict();

const layeredObjectUnionTypeSchema = z.object({
  kind: z.literal("object-union"),
  layers: z.array(z.enum(platformOntologyLayers)).nonempty(),
}).strict();

/** One selected object drawn from the declared layers, explicit types, or both. */
export const ontologyObjectUnionTypeSchema = z.union([
  explicitObjectUnionTypeSchema,
  layeredObjectUnionTypeSchema,
  layeredObjectUnionTypeSchema.merge(explicitObjectUnionTypeSchema),
]);
export type OntologyObjectUnionType = z.infer<typeof ontologyObjectUnionTypeSchema>;

/** Resolve layer selectors against the current type declarations, keeping the selector in the stored manifest. */
export function objectUnionTypes(field: OntologyObjectUnionType): readonly string[] {
  const layers = "layers" in field ? field.layers : undefined;
  const layeredTypes = layers === undefined ? [] : Object.entries(platformObjectTypes)
    .filter(([, { layer }]) => layer !== undefined && layers.includes(layer))
    .map(([id]) => id);
  return [...new Set([...layeredTypes, ...("objectTypes" in field ? field.objectTypes : [])])];
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
/** The reader's coordinates, stored by node key. Null clears a saved layout. */
export const panelNodePositionsValueSchema = z.record(z.string().min(1), z.object({
  x: z.number().finite(), y: z.number().finite(),
}).strict()).nullable();
export type PanelNodePositionsValue = z.infer<typeof panelNodePositionsValueSchema>;

export const panelStateValueSchema = z.union([panelDeepLinkStateValueSchema, panelObjectCollectionValueSchema, panelNodePositionsValueSchema]);
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

/** A projection rendered inside one column of an ObjectList member in this same panel instance. */
export const panelListColumnRefSchema = z.object({
  slot: key,
  column: key,
}).strict();
export type PanelListColumnRef = z.infer<typeof panelListColumnRefSchema>;

/** A projection rendered inside the expandable row detail area of an ObjectList member in this same panel instance. */
export const panelListRowDetailRefSchema = z.object({
  slot: key,
}).strict();
export type PanelListRowDetailRef = z.infer<typeof panelListRowDetailRefSchema>;

const panelOperationInputRefSchema = z.union([
  panelStateRefSchema,
  z.object({ formField: panelFormFieldRefSchema.pick({ slot: true, path: true }) }).strict(),
]);

/** Values supplied by the placing panel to a read operation. */
export const panelReadOperationInputsSchema = z.object({
  draft: z.object({ slot: key }).strict().optional(),
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
  z.object({ source: z.literal("literal"), literal: panelObjectRefSchema }).strict(),
  z.object({ source: z.literal("none") }).strict(),
]);
export type PanelOperationTarget = z.infer<typeof panelOperationTargetSchema>;

/**
 * An operation as the agent and the header both receive it. `handlerRef` names an operation the SDK publishes; it is
 * never a URL, SQL or function source, so a described operation is one somebody registered (overall design 5.1). The
 * SDK receives the owner's admitted operation description. A state operation comes from the panel's own declaration.
 */
export const panelOperationIdSchema = z.string().min(1);

/** The owner's reason, in the reader's language, that this operation would currently be refused. */
export const panelOperationUnavailableSchema = z.object({
  reason: z.string().min(1).max(500),
}).strict();
export const panelOperationSchema = z
  .object({
    id: panelOperationIdSchema,
    label: z.string().min(1).max(200),
    kind: panelOperationKindSchema,
    unavailable: panelOperationUnavailableSchema.optional(),
    /** The parameters the operation takes, by name; a form save's parameters are the owner's form fields, read live. */
    inputSchema: runtimeJsonObjectSchema.default({}),
    /** Absent on a state operation: what it changes is the panel's own state, not an object. */
    target: panelOperationTargetSchema.optional(),
    /** The slot whose projection publishes this operation; absent on a state operation. */
    slot: key.optional(),
    /** The authorized placement of a nested publisher, relative to the opened panel. */
    memberPath: z.lazy(() => panelMemberPathSchema.nonempty()).optional(),
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
 * Read-only host list context supplied when invoking a row-scoped operation (`memberPath` carrying `itemKey`).
 *
 * Controlled value precedence (highest to lowest):
 * 1. `entry.inputs` (`literal` and `frameState`, verified by the server from the application entry)
 * 2. `rowContext.state` (non-controlled state fields of the placement panel owning the host list and column/detail member)
 * 3. `manifest.state` default values
 *
 * `rowContext.state` must never override entry-controlled values (`literal` or `frameState`).
 * When nested, `state` and `runtimeParams` are scoped to the actual placement panel owning the host list
 * and column/detail member.
 */
export const panelOperationRowContextSchema = z.object({
  /** Subset of manifest.state for the placement panel owning the host list and column/detail member. */
  state: z.record(key, runtimeJsonValueSchema).optional(),
  /** Frame manifest.state values when entry.inputs binds frameState (never substitutable by rowContext.state). */
  frameState: z.record(key, runtimeJsonValueSchema).optional(),
  /** Host list datum runtimeParams (e.g. search/cursor/size/page) used to locate the row. */
  runtimeParams: z.record(key, runtimeJsonValueSchema).optional(),
}).strict();
export type PanelOperationRowContext = z.infer<typeof panelOperationRowContextSchema>;

/**
 * The ID of an operation a projection publishes: the slot it sits in and the operation's own name, so two instances of
 * one panel and two panels using one projection describe the same operation the same way.
 */
export function panelOperationId(member: string | readonly string[], operation: string) {
  const members = typeof member === "string" ? [member] : member;
  return [...members, operation].join(".");
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

const themeOverridesByMode = z.record(key, z.string().trim());

/** Applications, panels and placements override the same public design tokens. */
export const panelThemeOverridesSchema = z.object({
  light: themeOverridesByMode.optional(),
  dark: themeOverridesByMode.optional(),
}).strict();
export type PanelThemeOverrides = z.infer<typeof panelThemeOverridesSchema>;

export const panelFixedMemberTargetSchema = z.union([
  z.object({ projectionId: key }).strict(),
  z.object({ panelId: key }).strict(),
]);
export type PanelFixedMemberTarget = z.infer<typeof panelFixedMemberTargetSchema>;

const panelIdCandidates = z.object({ panelIds: z.array(key).nonempty() }).strict();
const projectionIdCandidates = z.object({ projectionIds: z.array(key).nonempty() }).strict();
const objectDetailCandidates = z.object({ rule: z.literal("objectDetail") }).strict();
const usableCandidates = z.object({ rule: z.literal("usable") }).strict();
export const panelPlacementCandidatesSchema = z.union([
  panelIdCandidates, projectionIdCandidates, objectDetailCandidates, usableCandidates,
]);
export const panelCurrentEntryTargetSchema = z.object({
  fromPlatform: z.literal("currentEntry"), candidates: z.object({ rule: z.literal("applicationEntry") }).strict(),
}).strict();
export const panelMemberTargetSchema = z.union([
  panelFixedMemberTargetSchema,
  z.object({ fromState: key, candidates: panelPlacementCandidatesSchema }).strict(),
  panelCurrentEntryTargetSchema,
]);
export type PanelMemberTarget = z.infer<typeof panelMemberTargetSchema>;

const literalValue = z.object({ literal: runtimeJsonValueSchema }).strict();
const itemValue = z.object({ item: z.literal(true) }).strict();
const rowItemScalarValue = z.object({ item: z.enum(["primaryKey", "label"]) }).strict();
const rowItemFieldValue = z.object({ itemField: key }).strict();
const commandInputSchema = z.union([literalValue, panelStateRefSchema, itemValue]);
export const panelMemberInputSchema = z.union([
  literalValue,
  panelStateRefSchema,
  itemValue,
  rowItemScalarValue,
  rowItemFieldValue,
]);
export type PanelMemberInput = z.infer<typeof panelMemberInputSchema>;
const placementPorts = {
  inputs: z.record(key, panelMemberInputSchema).optional(),
  outputs: z.record(key, panelStateRefSchema).optional(),
  theme: panelThemeOverridesSchema.optional(),
};
export const panelPlacementSchema = z.object({
  id: key,
  target: panelFixedMemberTargetSchema,
  inputs: z.record(key, commandInputSchema).optional(),
  outputs: placementPorts.outputs,
  theme: placementPorts.theme,
}).strict();
export type PanelPlacement = z.infer<typeof panelPlacementSchema>;

export const panelMemberPathSegmentSchema = z.object({
  member: key,
  itemKey: panelMemberItemKeySchema.optional(),
  selection: z.union([
    z.object({ stateValue: runtimeJsonValueSchema, target: panelFixedMemberTargetSchema }).strict(),
    z.object({ placement: panelPlacementSchema.pick({ id: true, target: true }) }).strict(),
  ]).optional(),
}).strict();
export const panelMemberPathSchema = z.array(panelMemberPathSegmentSchema);
export type PanelMemberPath = z.infer<typeof panelMemberPathSchema>;

export const panelPlacementTypeSchema = z.object({
  kind: z.literal("placement"), candidates: panelPlacementCandidatesSchema,
}).strict();

export const panelNodePositionsTypeSchema = z.object({ kind: z.literal("node-positions") }).strict();

export const directPanelPortTypeSchema = z.union([
  ontologyParameterTypeSchema, panelPlacementTypeSchema, panelNodePositionsTypeSchema,
]);
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
    case "node-positions":
      return panelNodePositionsValueSchema.safeParse(value).success;
    case "placement": {
      const placement = panelPlacementSchema.safeParse(value);
      if (!placement.success) return false;
      if ("rule" in type.candidates) return true; // Dynamic candidates are resolved by their trusted owner.
      if ("panelIds" in type.candidates)
        return "panelId" in placement.data.target && type.candidates.panelIds.includes(placement.data.target.panelId);
      return "projectionId" in placement.data.target && type.candidates.projectionIds.includes(placement.data.target.projectionId);
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
  if (target.kind === "node-positions") return source.kind === "node-positions";
  if (source.kind !== "placement") return false;
  const allowed = target.candidates;
  const offered = source.candidates;
  if ("rule" in allowed) return "rule" in offered && allowed.rule === offered.rule;
  if ("panelIds" in allowed) return "panelIds" in offered && offered.panelIds.every(id => allowed.panelIds.includes(id));
  return "projectionIds" in offered && offered.projectionIds.every(id => allowed.projectionIds.includes(id));
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
  if (field.type.kind === "node-positions") {
    if (!field.personal) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["personal"], message: "Node positions must be personal state" });
    if (field.deepLink) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deepLink"], message: "Node positions cannot be carried in an address" });
  }
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
  listColumn: panelListColumnRefSchema.optional(),
  listRowDetail: panelListRowDetailRefSchema.optional(),
  readOperationInputs: z.record(key, panelReadOperationInputsSchema).optional(),
}).strict();
export type PanelMember = z.infer<typeof panelMemberSchema>;

/**
 * Whether a panel member is mounted by its host component (`ObjectForm` field, `ObjectList` column, or
 * `ObjectList` row detail) and therefore exempt from placing `<Projection slot="...">` in `panel.html`.
 */
export function isHostMountedPanelMember(
  member: Pick<PanelMember, "formField" | "listColumn" | "listRowDetail">,
): boolean {
  return member.formField !== undefined || member.listColumn !== undefined || member.listRowDetail !== undefined;
}

/** Member keys that belong directly in `panel.html` rather than being mounted by a host form or list member. */
export function panelTemplatePlacedMemberKeys(manifest: Pick<PanelManifest, "members">): string[] {
  return Object.entries(manifest.members)
    .filter(([, member]) => !isHostMountedPanelMember(member))
    .map(([memberKey]) => memberKey);
}

const commandInputs = z.record(key, commandInputSchema);
const openMember = z.object({
  mode: z.enum(["replace", "drawer", "dialog"]),
  member: key,
  inputs: commandInputs.optional(),
}).strict();
const openEntry = z.object({
  mode: z.literal("entry"),
  entry: z.union([
    z.object({ literal: panelObjectRefSchema.extend({ className: z.literal(APPLICATION_PANEL_USE) }) }).strict(),
    panelStateRefSchema, itemValue,
  ]),
  inputs: commandInputs.optional(),
}).strict();
export const panelCommandSchema = z.object({
  labelKey: panelMessageKeySchema,
  /** The primary button among this panel's header commands. */
  primary: z.literal(true).optional(),
  do: z.union([
    z.object({ set: z.object({ fields: commandInputs.refine(fields => Object.keys(fields).length > 0, "Set at least one state field") }).strict() }).strict(),
    z.object({ invoke: z.object({ member: key, operation: key, inputs: commandInputs }).strict() }).strict(),
    z.object({ open: z.union([openMember, openEntry]) }).strict(),
  ]),
}).strict();
export type PanelCommand = z.infer<typeof panelCommandSchema>;

const panelCommandsSchema = z.record(key, panelCommandSchema).superRefine((commands, ctx) => {
  let primary: string | undefined;
  for (const [name, command] of Object.entries(commands)) {
    if (!command.primary) continue;
    if (primary !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: [name, "primary"], message: `Command '${primary}' is already primary`,
      });
    } else {
      primary = name;
    }
  }
});

/** Header state changes must be reproducible by opening the panel's address. */
export function validatePanelCommandAddresses(
  { state, commands }: { state: PanelState; commands: Record<string, PanelCommand> },
  ctx: z.RefinementCtx,
) {
  for (const [name, command] of Object.entries(commands)) {
    if (!("set" in command.do)) continue;
    for (const field of Object.keys(command.do.set.fields)) {
      const path = ["commands", name, "do", "set", "fields", field];
      if (!Object.hasOwn(state, field)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `Undeclared reference '${field}'` });
      } else if (!state[field].deepLink) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path,
          message: `Header command '${name}' changes state '${field}', which the assistant cannot set by address. Mark it deepLink.`,
        });
      }
    }
  }
}

export const panelManifestSchema = z.object({
  state: panelStateSchema,
  members: z.record(key, panelMemberSchema),
  commands: panelCommandsSchema,
}).strict().superRefine(({ state, members, commands }, ctx) => {
  validatePanelCommandAddresses({ state, commands }, ctx);
  function issue(path: string[], message: string) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  }
  function requireName(scope: Record<string, unknown>, name: string, path: string[]) {
    if (!Object.hasOwn(scope, name)) issue(path, `Undeclared reference '${name}'`);
  }
  const seenListColumns = new Map<string, string>();
  const seenListRowDetails = new Map<string, string>();
  for (const [member, declaration] of Object.entries(members)) {
    const path = ["members", member];
    if ("fromState" in declaration.target) {
      const { fromState, candidates } = declaration.target;
      const sourcePath = [...path, "target", "fromState"];
      if (!Object.hasOwn(state, fromState)) requireName(state, fromState, sourcePath);
      else {
        const type = state[fromState].type;
        const objectDetail = "rule" in candidates && candidates.rule === "objectDetail";
        const valid = objectDetail
          ? type.kind === "object" || type.kind === "object-union"
          : type.kind === "object" && (
            "panelIds" in candidates ? type.objectType === PRODUCT_PANEL
              : "projectionIds" in candidates ? type.objectType === PRODUCT_PROJECTION
                : type.objectType === PRODUCT_PANEL || type.objectType === PRODUCT_PROJECTION
          );
        if (!valid) issue(sourcePath, "The state type does not match this placement's candidates");
      }
    }
    if ("fromPlatform" in declaration.target && Object.keys(declaration.inputs ?? {}).length > 0) {
      issue([...path, "inputs"], "The application entry supplies the inputs for this member");
    }
    const isListAttached = declaration.listColumn !== undefined || declaration.listRowDetail !== undefined;
    for (const [name, input] of Object.entries(declaration.inputs ?? {})) {
      if ("state" in input) requireName(state, input.state, [...path, "inputs", name, "state"]);
      if ((("item" in input && input.item !== true) || "itemField" in input) && !isListAttached) {
        issue(
          [...path, "inputs", name],
          "Row scalar and field inputs ({item: 'primaryKey'|'label'} and {itemField}) are only allowed on listColumn or listRowDetail members",
        );
      }
    }
    for (const [name, output] of Object.entries(declaration.outputs ?? {}))
      requireName(state, output.state, [...path, "outputs", name, "state"]);
    const attachments = [
      declaration.formField !== undefined ? "formField" : null,
      declaration.listColumn !== undefined ? "listColumn" : null,
      declaration.listRowDetail !== undefined ? "listRowDetail" : null,
    ].filter((kind): kind is "formField" | "listColumn" | "listRowDetail" => kind !== null);
    if (attachments.length > 1) {
      for (const attachment of attachments.slice(1)) {
        issue([...path, attachment], "A member may declare at most one of formField, listColumn, or listRowDetail");
      }
    }
    if (declaration.formField) {
      const { slot } = declaration.formField;
      if (slot === member) issue([...path, "formField", "slot"], "A field port must reference another member");
      else requireName(members, slot, [...path, "formField", "slot"]);
    }
    if (declaration.listColumn) {
      const { slot, column } = declaration.listColumn;
      if (slot === member) issue([...path, "listColumn", "slot"], "A list column member must reference another member");
      else if (!Object.hasOwn(members, slot)) requireName(members, slot, [...path, "listColumn", "slot"]);
      else if (!("projectionId" in members[slot].target))
        issue([...path, "listColumn", "slot"], "A list column host must be a fixed projection member");
      if (!("projectionId" in declaration.target))
        issue([...path, "target"], "A list column member must target a fixed projection");
      if (Object.keys(declaration.outputs ?? {}).length > 0)
        issue([...path, "outputs"], "A list column member cannot declare outputs");
      const columnKey = `${slot}\u0000${column}`;
      const existing = seenListColumns.get(columnKey);
      if (existing !== undefined) {
        issue([...path, "listColumn"], `List '${slot}' column '${column}' already has a column member '${existing}'`);
      } else {
        seenListColumns.set(columnKey, member);
      }
    }
    if (declaration.listRowDetail) {
      const { slot } = declaration.listRowDetail;
      if (slot === member) issue([...path, "listRowDetail", "slot"], "A list row detail member must reference another member");
      else if (!Object.hasOwn(members, slot)) requireName(members, slot, [...path, "listRowDetail", "slot"]);
      else if (!("projectionId" in members[slot].target))
        issue([...path, "listRowDetail", "slot"], "A list row detail host must be a fixed projection member");
      if (!("projectionId" in declaration.target))
        issue([...path, "target"], "A list row detail member must target a fixed projection");
      if (Object.keys(declaration.outputs ?? {}).length > 0)
        issue([...path, "outputs"], "A list row detail member cannot declare outputs");
      const existing = seenListRowDetails.get(slot);
      if (existing !== undefined) {
        issue([...path, "listRowDetail"], `List '${slot}' already has a row detail member '${existing}'`);
      } else {
        seenListRowDetails.set(slot, member);
      }
    }
    for (const [operation, { draft, parameters, bindingId }] of Object.entries(declaration.readOperationInputs ?? {})) {
      if (draft) requireName(members, draft.slot, [...path, "readOperationInputs", operation, "draft", "slot"]);
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
  for (const [name, command] of Object.entries(commands)) {
    const path = ["commands", name];
    const action = command.do;
    const [operation, values] = "set" in action ? ["set", action.set.fields] as const
      : "invoke" in action ? ["invoke", action.invoke.inputs] as const
      : ["open", action.open.inputs ?? {}] as const;
    if ("invoke" in action) requireName(members, action.invoke.member, [...path, "do", "invoke", "member"]);
    if ("open" in action && "member" in action.open) requireName(members, action.open.member, [...path, "do", "open", "member"]);
    if ("open" in action && action.open.mode === "entry") {
      const entry = action.open.entry;
      if ("state" in entry) requireName(state, entry.state, [...path, "do", "open", "entry", "state"]);
    }
    for (const [field, value] of Object.entries(values)) {
      const valuePath = [...path, "do", operation, operation === "set" ? "fields" : "inputs", field];
      if ("state" in value) requireName(state, value.state, [...valuePath, "state"]);
      if (operation === "set" && Object.hasOwn(state, field)) {
        const target = state[field].type;
        if ("literal" in value && !matchesDirectPanelValue(target, value.literal))
          issue([...valuePath, "literal"], "The value does not match the target state type");
        if ("state" in value && Object.hasOwn(state, value.state) && !panelPortAccepts(target, state[value.state].type))
          issue([...valuePath, "state"], "The source state type does not match the target state type");
      }
    }
  }
});
export type PanelManifest = z.infer<typeof panelManifestSchema>;

export const directPanelManifestSchema = panelManifestSchema;
export type DirectPanelManifest = PanelManifest;

export function definePanel(manifest: z.input<typeof panelManifestSchema>): PanelManifest {
  return panelManifestSchema.parse(manifest);
}
