import { declaredCustomerFormSaveName } from "@ontomato/contracts/panel-projection";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormTarget, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { formFieldPointer } from "@ontomato/contracts/form-fields";
import type {
  PanelFormDescription,
  PanelFormField,
  PanelFormRequest,
  PanelFormSaveInput,
  PanelFormValues,
  ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "./direct";
import type { PanelInstance } from "./instance";
import type { PanelMemberContext } from "./member";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PlatformObjectRefusal } from "./platform-objects";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { FormSubmitOverride } from "./forms";
import type { MemberOperationsState } from "./member-operations";
import { serializeActionParamValue } from "../base/operation-input-schema";
import { jsonValuesEqual, valueAt } from "./form-values";

/*
 * Where an owner form reads its description and saves: in a panel's frame, the resource module of the bound type; in a
 * directly rendered panel, the member's `form` (or `createForm`) datum, read by the instance through the platform, and the owner's own
 * save operation, received by the platform's coordinator as an agent's call is. The form itself is the same either way.
 */

/** Extra context passed by ObjectForm when saving through a customer Action (kept off the wire for `form.save`). */
export interface FormSaveContext {
  readonly changedFields?: readonly string[];
  readonly baselineValues?: PanelFormValues;
  readonly formatUnwiredFieldRefusal?: (paths: readonly string[]) => {
    readonly message: string;
    readonly fieldMessage: (path: string) => string;
  };
}

/** Outcome returned by a form save: the saved/created object primary key (or null when an action did not report one). */
export interface FormSaveResult {
  readonly primaryKey: string | null;
  readonly message?: string;
}

/** What an owner form asks of where it reads and saves. */
export interface FormSource {
  describe(request: PanelFormRequest): Promise<PanelFormDescription>;
  prepareActionSave(target: PanelFormTarget, input: PanelFormSaveInput, context: FormSaveContext):
    { operationId: string; call: PanelOperationCall } | null;
  save(
    target: PanelFormTarget,
    input: PanelFormSaveInput,
    override?: FormSubmitOverride,
    context?: FormSaveContext,
  ): Promise<FormSaveResult>;
}

/** The input a form's `form` datum reads its object from: the panel state the edited object is held in. */
export function editedInput(projection: ProductProjection): string | undefined {
  const data = projection.data.form;
  return data && "object" in data.source && "input" in data.source.object ? data.source.object.input : undefined;
}

/**
 * The member's form save as its owner admits it now: the one of its projection's operations the owner describes as a
 * form's save, under the projection's name for it, with the target the owner admits — the edited object, or a new one.
 * None while the operations are read, or while the owner admits no save (nothing chosen, and nothing to create).
 */
export function formSave(
  state: MemberOperationsState,
  target: PanelFormTarget,
  projectionOperations: ProductProjection["operations"],
): { name: string; descriptor: PanelOwnerOperationDescriptor } | null {
  if (state.status !== "ready") return null;
  const saves = Object.entries(state.value).filter(([, descriptor]) => descriptor.kind === "form.save");
  if (saves.length > 1) throw new Error(`A form saves through one operation; its projection names ${saves.map(([name]) => name).join(", ")}`);
  if (saves.length === 1) return { name: saves[0]![0], descriptor: saves[0]![1] };

  const creating = target.kind === "draft";
  const name = declaredCustomerFormSaveName(projectionOperations, creating);
  if (name === undefined) return null;

  const descriptor = state.value[name];
  if (!descriptor || descriptor.kind !== "action" || descriptor.effect !== "write" || descriptor.handlerRef !== "actions.execute") {
    return null;
  }
  const targetless = descriptor.target.source === "none" || descriptor.target.source === "draft";
  return creating === targetless ? { name, descriptor } : null;
}

/** A datum the owner did not answer with a value: no permission, or the reason it could not be read. */
export class MemberDataUnavailable extends Error {
  constructor(readonly state: Exclude<MemberDataState, { status: "ready" }>) {
    super(state.status === "error" ? state.message : state.status);
    this.name = "MemberDataUnavailable";
  }
}

/** A comparable key for a form target: the object's primary key, "draft" for a create form, or empty for none. */
export const formTargetKey = (value: PanelFormTarget | null) =>
  value === null ? "" : value.kind === "object" ? value.primaryKey : "draft";

/**
 * The form of a directly rendered member: an object's from its `form` datum, a new one's from its `createForm` datum
 * (the type's create form), and either saved through its owner's `save`.
 */
function fieldMessages(errors: readonly { field: string; message: string }[] = []) {
  return Object.fromEntries(errors.map(({ field, message }) => [field.startsWith("/") ? field : `/${field}`, message]));
}

/** One declared parameter's resolved source on a customer Action save operation. */
export type ActionSaveParamWiring =
  | { readonly kind: "field"; readonly path: string; readonly isJson: boolean }
  | { readonly kind: "fields"; readonly fields: Readonly<Record<string, string>>; readonly isJson: true }
  | { readonly kind: "literal"; readonly value: RuntimeJsonValue; readonly isJson: boolean }
  | { readonly kind: "input"; readonly input: string; readonly isJson: boolean };

/** Resolved parameter wiring and editable form field JSON Pointers for a customer Action save operation. */
export interface ActionSaveWiring {
  readonly params: Readonly<Record<string, ActionSaveParamWiring>>;
  readonly wiredPaths: ReadonlySet<string>;
}

/** Empty wiring for a customer form that currently has no admitted, target-matching save Action. */
export function emptyActionSaveWiring(): ActionSaveWiring {
  return { params: {}, wiredPaths: new Set() };
}

/** Whether a customer-class form relies on an Action for saving. */
export function isCustomerActionForm(projection: Pick<ProductProjection, "operations">, objectType: string): boolean {
  const entries = Object.entries(projection.operations ?? {});
  if (entries.some(([, binding]) => binding.operation.kind === "PlatformOperation")) return false;
  const actions = entries.filter(([, binding]) => binding.operation.kind === "Action");
  return !objectType.startsWith("platform:") || actions.length === 1 || actions.some(([name]) => name === "save" || name === "create");
}

function isPlainRecord(value: unknown): value is Record<string, RuntimeJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Whether a form field JSON Pointer is directly wired or lives under a wired parent pointer. */
export function isFormPathWired(path: string, wiredPaths: ReadonlySet<string>): boolean {
  if (wiredPaths.has(path)) return true;
  for (const wired of wiredPaths) {
    if (path.startsWith(`${wired}/`)) return true;
  }
  return false;
}

function hasWiredDescendant(path: string, wiredPaths: ReadonlySet<string>): boolean {
  const prefix = `${path}/`;
  for (const wired of wiredPaths) {
    if (wired.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Resolves how a customer Action's declared `values` parameters map to form field JSON Pointers:
 * - Parameters explicitly bound in `binding.params` follow `{ formField }`, `{ formFields }`, `{ literal }`, or `{ input }`.
 * - Unbound declared parameters connect directly by same name to `/<escaped-param>`.
 * Returns `null` when the operation is not a parameterised `values` Action (such as platform `form.save`).
 */
export function resolveActionSaveWiring(
  descriptor: PanelOwnerOperationDescriptor,
  binding?: ProjectionOperationBinding,
): ActionSaveWiring | null {
  if (descriptor.kind === "form.save") return null;
  const schemaProps = descriptor.inputSchema.properties as Record<string, unknown> | undefined;
  const valuesSchema = schemaProps?.values as { properties?: Record<string, { contentMediaType?: string }> } | undefined;
  const declared = valuesSchema?.properties;
  if (!declared) return null;

  const params: Record<string, ActionSaveParamWiring> = {};
  const wiredPaths = new Set<string>();
  const boundParams = binding?.params;

  for (const [param, paramSchema] of Object.entries(declared)) {
    const isJson = paramSchema?.contentMediaType === "application/json";
    if (boundParams && Object.hasOwn(boundParams, param)) {
      const spec = boundParams[param]!;
      if ("formField" in spec) {
        params[param] = { kind: "field", path: spec.formField, isJson };
        wiredPaths.add(spec.formField);
      } else if ("formFields" in spec) {
        params[param] = { kind: "fields", fields: spec.formFields, isJson: true };
        for (const fieldPointer of Object.values(spec.formFields)) wiredPaths.add(fieldPointer);
      } else if ("literal" in spec) {
        params[param] = { kind: "literal", value: spec.literal, isJson };
      } else if ("input" in spec) {
        params[param] = { kind: "input", input: spec.input, isJson };
      }
      continue;
    }
    const path = formFieldPointer("/", param);
    params[param] = { kind: "field", path, isJson };
    wiredPaths.add(path);
  }
  return { params, wiredPaths };
}

/**
 * Marks every non-hidden form field without a submit destination in `wiredPaths` read-only with `readOnlyReason`,
 * preserving any owner-declared or fixed-field read-only state and reasons untouched.
 */
export function applyActionSaveReadOnly(
  fields: readonly PanelFormField[],
  wiredPaths: ReadonlySet<string>,
  readOnlyReason: string,
  base = "",
): PanelFormField[] {
  return fields.map((field) => {
    const absolutePath = base + field.path;
    if (field.readOnly || field.control.kind === "hidden") return field;
    if (isFormPathWired(absolutePath, wiredPaths)) return field;
    if (field.control.kind === "object" && hasWiredDescendant(absolutePath, wiredPaths)) {
      const nextFields = applyActionSaveReadOnly(field.control.fields, wiredPaths, readOnlyReason, absolutePath);
      const nextVariants = field.control.variants
        ? Object.fromEntries(Object.entries(field.control.variants).map(([key, variantFields]) => [
            key,
            applyActionSaveReadOnly(variantFields, wiredPaths, readOnlyReason, absolutePath),
          ]))
        : undefined;
      return {
        ...field,
        control: {
          ...field.control,
          fields: nextFields,
          ...(nextVariants ? { variants: nextVariants } : {}),
        },
      };
    }
    return { ...field, readOnly: true, readOnlyReason };
  });
}

function collectUnwiredObjectDiffs(
  path: string,
  before: RuntimeJsonValue | undefined,
  after: RuntimeJsonValue | undefined,
  wiredPaths: ReadonlySet<string>,
  unwired: Set<string>,
): void {
  if (isFormPathWired(path, wiredPaths)) return;
  if (jsonValuesEqual(before, after)) return;
  const beforeRecord = isPlainRecord(before) ? before : undefined;
  const afterRecord = isPlainRecord(after) ? after : undefined;
  const bothObjectLike =
    (beforeRecord !== undefined || before === undefined || before === null)
    && (afterRecord !== undefined || after === undefined || after === null)
    && (beforeRecord !== undefined || afterRecord !== undefined);
  if (!hasWiredDescendant(path, wiredPaths) || !bothObjectLike) {
    unwired.add(path);
    return;
  }
  const keys = new Set([...Object.keys(beforeRecord ?? {}), ...Object.keys(afterRecord ?? {})]);
  for (const key of keys) {
    const childPath = `${path}/${escapePointerSegment(key)}`;
    collectUnwiredObjectDiffs(childPath, beforeRecord?.[key], afterRecord?.[key], wiredPaths, unwired);
  }
}

function isAncestorModified(
  path: string,
  modifiedSet: ReadonlySet<string>,
): boolean {
  let slash = path.lastIndexOf("/");
  while (slash > 0) {
    const ancestor = path.slice(0, slash);
    if (modifiedSet.has(ancestor)) return true;
    slash = ancestor.lastIndexOf("/");
  }
  return false;
}

function isFieldCleared(
  path: string,
  modifiedSet: ReadonlySet<string>,
  baselineValues?: PanelFormValues,
): boolean {
  if (modifiedSet.has(path)) return true;
  return isAncestorModified(path, modifiedSet)
    && (baselineValues === undefined || valueAt(baselineValues, path) !== undefined);
}

/** Returns every modified or submitted field JSON Pointer that has no destination in the Action save wiring. */
export function unwiredModifiedPaths(
  wiredPaths: ReadonlySet<string>,
  modifiedPaths: Iterable<string>,
  formValues: PanelFormValues,
  baselineValues?: PanelFormValues,
): string[] {
  const unwired = new Set<string>();
  for (const path of modifiedPaths) {
    if (isFormPathWired(path, wiredPaths)) continue;
    if (hasWiredDescendant(path, wiredPaths) && baselineValues !== undefined) {
      collectUnwiredObjectDiffs(path, valueAt(baselineValues, path), valueAt(formValues, path), wiredPaths, unwired);
      continue;
    }
    unwired.add(path);
  }
  return [...unwired];
}

/**
 * Validates that every modified/submitted form field has a submit destination in the customer Action and converts live
 * form values into `{ values: Record<string, string> }` without silently dropping cleared `null`/empty values.
 */
function prepareActionSaveInput(
  descriptor: PanelOwnerOperationDescriptor,
  formValues: PanelFormValues,
  options: {
    readonly binding?: ProjectionOperationBinding;
    readonly submittedFields?: readonly string[];
    readonly changedFields?: readonly string[];
    readonly baselineValues?: PanelFormValues;
    readonly extraInput?: Readonly<Record<string, unknown>>;
    readonly memberInputs?: Readonly<Record<string, unknown>>;
    readonly formatUnwiredFieldRefusal?: FormSaveContext["formatUnwiredFieldRefusal"];
  } = {},
): { input: Record<string, unknown> } | { refusal: PlatformObjectRefusal } {
  const wiring = resolveActionSaveWiring(descriptor, options.binding);
  if (!wiring) {
    return { input: { ...formValues, ...(options.extraInput ?? {}) } };
  }

  const modifiedSet = new Set<string>([
    ...(options.submittedFields ?? []),
    ...(options.changedFields ?? []),
  ]);
  const unwired = unwiredModifiedPaths(wiring.wiredPaths, modifiedSet, formValues, options.baselineValues);
  if (unwired.length > 0) {
    const formatted = options.formatUnwiredFieldRefusal?.(unwired);
    const message = formatted?.message
      ?? `Cannot save: the current save action does not accept changes to ${unwired.join(", ")}`;
    const fieldErrors = Object.fromEntries(unwired.map((path) => [
      path,
      formatted?.fieldMessage(path) ?? "Not modified by the current save action",
    ]));
    return { refusal: new PlatformObjectRefusal(message, fieldErrors) };
  }

  const extraValues = (
    options.extraInput
    && typeof options.extraInput.values === "object"
    && options.extraInput.values !== null
    && !Array.isArray(options.extraInput.values)
  )
    ? (options.extraInput.values as Record<string, unknown>)
    : undefined;

  const serialized: Record<string, string> = {};
  for (const [param, source] of Object.entries(wiring.params)) {
    if (extraValues && Object.hasOwn(extraValues, param)) {
      const extra = extraValues[param];
      if (extra !== undefined) {
        // `extraInput.values` from operation dispatch is already serialized into action form strings;
        // preserve strings as-is to avoid double-encoding JSON-typed parameters.
        serialized[param] = typeof extra === "string"
          ? extra
          : serializeActionParamValue(extra, source.isJson);
      }
      continue;
    }
    if (source.kind === "field") {
      const raw = valueAt(formValues, source.path);
      if (raw === undefined) {
        if (isFieldCleared(source.path, modifiedSet, options.baselineValues)) {
          serialized[param] = serializeActionParamValue(null, source.isJson);
        }
        continue;
      }
      serialized[param] = serializeActionParamValue(raw, source.isJson);
    } else if (source.kind === "fields") {
      const packed: Record<string, RuntimeJsonValue> = {};
      for (const [key, fieldPointer] of Object.entries(source.fields)) {
        const raw = valueAt(formValues, fieldPointer);
        if (raw !== undefined) {
          packed[key] = raw;
        } else if (isFieldCleared(fieldPointer, modifiedSet, options.baselineValues)) {
          packed[key] = null;
        }
      }
      serialized[param] = JSON.stringify(packed);
    } else if (source.kind === "literal") {
      serialized[param] = serializeActionParamValue(source.value, source.isJson);
    } else if (source.kind === "input") {
      if (options.memberInputs && Object.hasOwn(options.memberInputs, source.input) && options.memberInputs[source.input] !== undefined) {
        serialized[param] = serializeActionParamValue(options.memberInputs[source.input], source.isJson);
      }
    }
  }
  return { input: { values: serialized } };
}

export function resolveFormSaveAnswer(
  answer: { readonly decision: "confirm" | "cancel"; readonly response?: import("@ontomato/contracts/panel-agent").PanelHumanOperationDispatchResponse },
  target: PanelFormTarget,
  descriptorKind: "form.save" | "action",
  objectType: string | null,
): FormSaveResult {
  if (answer.decision === "cancel" || !answer.response) throw new Error("The save was cancelled");
  const { response } = answer;
  if (response.kind === "not-dispatched") throw new Error(response.message);
  const outcome = response.outcome;
  if (outcome === null) throw new Error("Whether the owner saved is not known");
  if (outcome.kind === "success") {
    if (target.kind === "object") return { primaryKey: target.primaryKey, message: outcome.message };
    // A new object is the one of the form's type the owner reports it created.
    const created = (outcome.affected?.objects ?? []).filter((object) => object.objectType === objectType);
    if (created.length === 1) return { primaryKey: created[0]!.primaryKey, message: outcome.message };
    // A customer Action (such as a targetless create Action) may succeed without reporting a single new primary key.
    if (descriptorKind === "action") return { primaryKey: null, message: outcome.message };
    throw new Error("The owner did not report the one object it created");
  }
  if (outcome.kind === "refusal" || outcome.kind === "failure") {
    // The owner names each refused field by its JSON Pointer.
    throw new PlatformObjectRefusal(outcome.message, fieldMessages(outcome.errors), undefined, outcome.savedFields);
  }
  if (outcome.kind === "batch") throw new Error("A form's save is one call, not a batch");
  throw new Error(outcome.message);
}

export function memberFormSource(member: PanelMemberContext, instance: PanelInstance): FormSource {
  const { projection } = member;
  /** The datum a target's form is read from, and the run inputs that read it for the target and the form's values. */
  function formRead(target: PanelFormTarget, values: PanelFormValues | undefined, changedField: string | null) {
    const name = target.kind === "object" ? "form" : "createForm";
    const data = projection.data[name];
    if (!data) throw new Error(`Member '${member.key}' declares no ${name} datum: it ${target.kind === "object" ? "edits no object" : "creates nothing"}`);
    const params: Record<string, RuntimeJsonValue> = { ...(values === undefined ? {} : { values }), changedField };
    const inputs: Record<string, RuntimeJsonValue> = {};
    if (target.kind === "object") {
      if (!("object" in data.source) || !("input" in data.source.object))
        throw new Error(`Member '${member.key}' reads its form from no object one of its inputs names`);
      inputs[data.source.object.input] = { className: target.objectType, primaryKey: target.primaryKey };
    }
    return { name, params, inputs, type: "type" in data.source ? data.source.type.id : null };
  }

  function actionSaveInput(
    descriptor: PanelOwnerOperationDescriptor,
    binding: ProjectionOperationBinding | undefined,
    input: PanelFormSaveInput,
    context?: FormSaveContext,
    extraInput?: Readonly<Record<string, unknown>>,
  ) {
    return prepareActionSaveInput(descriptor, input.values, {
      binding,
      submittedFields: input.submittedFields,
      changedFields: context?.changedFields,
      baselineValues: context?.baselineValues,
      extraInput,
      memberInputs: member.inputs.value,
      formatUnwiredFieldRefusal: context?.formatUnwiredFieldRefusal,
    });
  }

  return {
    async describe({ target, values, changedField }) {
      const { name, params, inputs } = formRead(target, values, changedField);
      const result = await member.data.read(name, params, inputs);
      if (result.status !== "ready") throw new MemberDataUnavailable(result);
      return result.value as PanelFormDescription;
    },
    prepareActionSave(target, input, context) {
      const save = formSave(member.operations.value, target, projection.operations);
      if (!save || save.descriptor.kind !== "action") return null;
      const prepared = actionSaveInput(save.descriptor, projection.operations?.[save.name], input, context);
      if ("refusal" in prepared) return null;
      return {
        operationId: instance.operationIdOf(member.key, save.name),
        call: { target: save.descriptor.target.source === "none" ? null : target, input: prepared.input },
      };
    },
    async save(target, input, override, context) {
      const save = override ? null : formSave(member.operations.value, target, projection.operations);
      if (!override && !save) throw new Error(`The owner admits no save for the form in member '${member.key}' now`);
      const operationId = override?.operationId ?? instance.operationIdOf(member.key, save!.name);
      const descriptor = override?.descriptor ?? save!.descriptor;
      const binding = override ? override.binding : projection.operations?.[save!.name];
      const prepared = descriptor.kind === "form.save"
        ? { input }
        : actionSaveInput(descriptor, binding, input, context, override?.extraInput);
      if ("refusal" in prepared) throw prepared.refusal;
      const callTarget = descriptor.target.source === "none" ? null : target;
      const answer = await instance.writeOperation(operationId, { call: { target: callTarget, input: prepared.input } });
      const { type } = target.kind === "object" ? { type: target.objectType } : formRead(target, undefined, null);
      return resolveFormSaveAnswer(answer, target, descriptor.kind, type);
    },
  };
}
