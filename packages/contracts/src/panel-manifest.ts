import { z } from "zod";
import type { ontologyParameterTypeSchema } from "./product-projections";

/*
 * What a panel's `panel.mjs` exports through `definePanel`: the state the panel keeps for one instance, the projections
 * it composes into slots, the operations it offers, and nothing about how it is drawn (the HTML and the module own
 * layout and interaction). The SDK mounts the panel from this declaration, so a panel author never wires up page
 * context, deep links, draft dispatch or button execution by hand; the registry stores the declaration beside the
 * panel's content, and the graph reads it instead of the HTML.
 *
 * State and values are typed by `ontologyParameterTypeSchema` (overall design 3.3, 3.4): an object reference carries
 * only the ontology class and the primary key, so the panel names one business object and never a copy of its data.
 */

const key = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "Reserved key");

/** A state field's declared type: a reference to one ontology object, or a scalar value. */
export const panelStateTypeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("object"), objectType: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("scalar"), type: z.enum(["string", "number", "boolean", "date"]) }).strict(),
]);
export type PanelStateType = z.infer<typeof panelStateTypeSchema>;

/** The same type vocabulary as a panel's values, so a slot input compares against a projection's parameter. */
export type PanelValueType = z.infer<typeof ontologyParameterTypeSchema>;

/**
 * One field of a panel's own state. Two instances of the same panel keep separate values, so a selection made in one is
 * never seen by the other; a shared projection receives the state as an input value instead (overall design 3.2, 10.1).
 */
export const panelStateFieldSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("object"),
      objectType: z.string().min(1).max(200),
      /** An object the panel starts on when its instance is opened without one, by primary key. */
      defaultValue: z.string().min(1).max(1000).optional(),
      /**
       * Whether the value may travel in the address (`?state=`), so a link or an agent's open request restores the same
       * view. A field that is not deep-linkable stays inside the instance; form content never goes into the address.
       */
      deepLink: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scalar"),
      type: z.enum(["string", "number", "boolean", "date"]),
      defaultValue: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
      deepLink: z.boolean().default(false),
    })
    .strict(),
]);
export type PanelStateField = z.infer<typeof panelStateFieldSchema>;

/** The state a panel declares: fields by name, each with its own type. */
export const panelStateSchema = z.record(key, panelStateFieldSchema);
export type PanelState = z.infer<typeof panelStateSchema>;

/** A state value as the SDK holds it in an instance: an object reference, a scalar, or nothing yet. */
export const panelStateValueSchema = z
  .union([
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

/**
 * A projection placed in a slot. The slot carries the projection's ID and the values it is given; the projection's own
 * component, binding and display stay with the projection, and a panel that needs another presentation registers
 * another projection instead of overriding one here (overall design 3.2).
 */
export const panelSlotSchema = z
  .object({
    projectionId: z.string().min(1).max(200),
    /** Values passed to the projection's declared inputs, by parameter name, each from this panel's state. */
    inputs: z.record(key, panelStateRefSchema).default({}),
    /**
     * Whether the slot is shown at all, still declared while it is hidden: the graph needs every composed projection,
     * and a form behind a collapsed section must reach the agent that fills it (overall design 3.3).
     */
    visibleWhen: z
      .object({ state: key, operator: z.enum(["present", "empty"]), value: z.string().max(1000).optional() })
      .strict()
      .optional(),
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
 * An operation as the agent and the header both receive it. `handlerRef` names an operation the panel's projections
 * publish (the SDK client call the projection is bound to); it is never a URL, SQL or function source, so a described
 * operation is one somebody registered (overall design 5.1).
 */
export const panelOperationSchema = z
  .object({
    id: key,
    label: z.string().min(1).max(200),
    kind: panelOperationKindSchema,
    /** The parameters the operation takes, by name; a form save's parameters are the owner's form fields, read live. */
    inputSchema: z.record(key, panelStateTypeSchema).default({}),
    target: panelOperationTargetSchema,
    /** The slot whose projection publishes this operation. */
    slot: key,
    handlerRef: z.string().min(1).max(300),
  })
  .strict();
export type PanelOperation = z.infer<typeof panelOperationSchema>;

/**
 * What a panel declares. It is the SDK's whole source of truth about the panel: which projections it contains and in
 * which slot, what its state is, and which operations reach a reader or an agent.
 */
export const panelManifestSchema = z
  .object({
    state: panelStateSchema,
    slots: panelSlotsSchema,
    /** Every operation the panel offers, including those of projections that are not drawn yet. */
    operations: z.array(panelOperationSchema).max(100),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const [slot, declaration] of Object.entries(manifest.slots)) {
      for (const [input, ref] of Object.entries(declaration.inputs)) {
        if (!Object.hasOwn(manifest.state, ref.state))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", slot, "inputs", input], message: `Input '${input}' reads undeclared state '${ref.state}'` });
      }
      if (declaration.visibleWhen && !Object.hasOwn(manifest.state, declaration.visibleWhen.state))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", slot, "visibleWhen"], message: `Visible-when reads undeclared state '${declaration.visibleWhen.state}'` });
    }
    const ids = new Set<string>();
    for (const operation of manifest.operations) {
      if (ids.has(operation.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations"], message: `Duplicate operation '${operation.id}'` });
      ids.add(operation.id);
      if (!Object.hasOwn(manifest.slots, operation.slot))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", operation.id, "slot"], message: `Operation '${operation.id}' names undeclared slot '${operation.slot}'` });
      if (operation.target.source === "state" && !Object.hasOwn(manifest.state, operation.target.state))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", operation.id, "target"], message: `Operation '${operation.id}' targets undeclared state '${operation.target.state}'` });
      if (operation.target.source === "draft" && !Object.hasOwn(manifest.slots, operation.target.slot))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", operation.id, "target"], message: `Operation '${operation.id}' targets undeclared slot '${operation.target.slot}'` });
    }
  });
export type PanelManifest = z.infer<typeof panelManifestSchema>;

/**
 * What a panel module exports: `definePanel` hands back the declaration unchanged, so the module stays plain ES and the
 * registry checks it as external input. `manifest` is read by the SDK host and the registry, not by the HTML.
 */
export function definePanel(manifest: PanelManifest): PanelManifest {
  return manifest;
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
