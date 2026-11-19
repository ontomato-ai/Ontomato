import { z } from "zod";
import { runtimeIdSchema } from "./agent-runtime-values";
import { formFieldErrorSchema } from "./form-fields";
import { pageDraftPathSchema } from "./page-draft";

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

/**
 * The typed value vocabulary of a panel: a reference to one ontology object (class and primary key, never a copy of its
 * data) or a scalar. Projections take their parameters in the same vocabulary, so a slot input and a projection's
 * parameter are compared without a translation table.
 */
export const ontologyParameterTypeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("object"), objectType: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("scalar"), type: z.enum(["string", "number", "boolean", "date"]) }).strict(),
]);
export type OntologyParameterType = z.infer<typeof ontologyParameterTypeSchema>;

/**
 * One field of a panel's own state. Two instances of the same panel keep separate values, so a selection made in one is
 * never seen by the other; a shared projection receives the state as an input value instead (overall design 3.2, 10.1).
 * The first object a panel shows comes from opening it (a deep link or an open request), never from the declaration: a
 * primary key in a shared panel would open every user's instance on the same object.
 */
export const panelStateFieldSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("object"), objectType: z.string().min(1).max(200), deepLink: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal("scalar"), type: z.enum(["string", "number", "boolean", "date"]), deepLink: z.boolean().default(false) }).strict(),
]);
export type PanelStateField = z.infer<typeof panelStateFieldSchema>;

/** The state a panel declares: fields by name, each with its own type. */
export const panelStateSchema = z.record(key, panelStateFieldSchema);
export type PanelState = z.infer<typeof panelStateSchema>;

/** A state value as the SDK holds it in an instance: an object reference, a scalar, or nothing yet. */
export const panelStateValueSchema = z.union([
  z.object({ className: z.string().min(1).max(200), primaryKey: z.string().min(1).max(1000) }).strict(),
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
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
  /** JSON Pointer relative to the owner form's values. */
  path: formFieldErrorSchema.shape.field,
}).strict();
export type PanelFormFieldRef = z.infer<typeof panelFormFieldRefSchema>;

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
    formField: panelFormFieldRefSchema.optional(),
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

/**
 * One call of an operation: what it acts on and what the caller supplies. The target is a value here, not a reference to
 * the declaration — the object the reader has selected, or the draft's own object — so a caller outside the panel (the
 * platform's coordinator, on an agent's behalf) sends exactly what a person's click sends, and the handler needs nothing
 * from the panel's state to know which object it acts on.
 */
export const panelObjectIdentitySchema = z.object({
  objectType: key,
  primaryKey: z.string().min(1).max(1000),
}).strict();
export type PanelObjectIdentity = z.infer<typeof panelObjectIdentitySchema>;

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
    draft: z.object({ sessionId: runtimeIdSchema, runId: runtimeIdSchema, path: pageDraftPathSchema }).strict().optional(),
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
    label: z.string().min(1).max(200),
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
    state: z.record(key, panelStateValueSchema).default({}),
  })
  .strict();
export type PanelOpenRequest = z.infer<typeof panelOpenRequestSchema>;
