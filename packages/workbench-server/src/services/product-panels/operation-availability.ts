import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import { panelObjectRefSchema, panelOperationUnavailableSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  operationAcceptsTargetType, panelRecordObjectRef, panelRowOperationKey, type PanelRecord, type ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import { HttpError } from "../../utils/errors";
import { readViaJava, type JavaPanelReadResult } from "./java-panel-reads";
import type { BoundProjectionOperation } from "./operation-bindings";
import { javaReadItem, type CarriedRowFacts, type RegisteredDataReadItem } from "./registered-data-read";
import type {
  PanelOperationAvailability, PanelOperationAvailabilityTarget, PanelOperationFactsContext, PanelOperationInputForm,
  PanelOperationRefusal, PanelOperationTarget, PanelRecordTarget,
} from "./server-operations";

/*
 * The platform's one execution of operation availability. Every operation answers "can it act, and why not" from its
 * own declaration; here the targets a binding gives become reads, the reads become facts and the operation's rule
 * decides. Where the facts come from is settled when the read is planned: targets known then are read with the formal
 * page's second read or in one direct read, a row's facts come from the row itself or from its list, and an operation
 * that reads nothing per target takes its facts from Node when the rows are known.
 */

export function placedObject({ className, primaryKey }: ReturnType<typeof panelObjectRefSchema.parse>): PanelRecordTarget {
  return { kind: "object", objectType: className, primaryKey };
}

/** Whether a binding takes its target from the row it is shown on. */
export function rowTargetBinding(binding: ProjectionOperationBinding) {
  return binding.target !== undefined && ("row" in binding.target || "rowField" in binding.target);
}

/** Whether a binding takes any parameter from the row it is shown on. */
export function rowParamBinding(binding: ProjectionOperationBinding) {
  return Object.values(binding.params ?? {}).some(param => "row" in param || "rowField" in param);
}

export function resolvePinnedBoundParams(
  binding: ProjectionOperationBinding,
  pinnedInputs: ReadonlyMap<string, unknown>,
  target?: PanelOperationTarget | null,
  row?: PanelRecord,
): Record<string, unknown> {
  const boundParams: Record<string, unknown> = {};
  for (const [paramKey, paramBinding] of Object.entries(binding.params ?? {})) {
    if ("literal" in paramBinding) {
      boundParams[paramKey] = paramBinding.literal;
      continue;
    }
    if ("input" in paramBinding && pinnedInputs.has(paramBinding.input)) {
      boundParams[paramKey] = pinnedInputs.get(paramBinding.input);
      continue;
    }
    if (row && "row" in paramBinding) {
      boundParams[paramKey] = row[paramBinding.row];
      continue;
    }
    if (row && "rowField" in paramBinding) {
      boundParams[paramKey] = row.fields[paramBinding.rowField];
      continue;
    }
    if (
      "row" in paramBinding
      && paramBinding.row === "primaryKey"
      && binding.target
      && "row" in binding.target
      && target?.kind === "object"
    ) {
      boundParams[paramKey] = target.primaryKey;
    }
  }
  return boundParams;
}

/** A binding's fixed target: its literal, or the object its input holds; undefined when the input holds none. */
function fixedTarget(
  target: Extract<NonNullable<ProjectionOperationBinding["target"]>, { literal: unknown } | { input: string }>,
  inputs: Readonly<Record<string, unknown>>,
) {
  if ("literal" in target) return placedObject(target.literal);
  const parsed = panelObjectRefSchema.safeParse(inputs[target.input]);
  return parsed.success ? placedObject(parsed.data) : undefined;
}

/** The target a binding acts on for one row: the row itself, a reference in it, or the binding's fixed target. */
function rowTargetForBinding(
  binding: ProjectionOperationBinding,
  row: PanelRecord,
  fallbackClassName: string | undefined,
  inputs: Readonly<Record<string, unknown>>,
): PanelRecordTarget | null | undefined {
  const { target } = binding;
  if (!target) return null;
  if ("literal" in target || "input" in target) return fixedTarget(target, inputs);
  if ("row" in target) {
    try {
      return placedObject(panelRecordObjectRef(row, fallbackClassName));
    } catch {
      return undefined;
    }
  }
  const raw = row.fields[target.rowField];
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "kind" in raw && raw.kind === "reference") {
    const parsed = panelObjectRefSchema.safeParse({ className: raw.className, primaryKey: raw.primaryKey });
    return parsed.success ? placedObject(parsed.data) : undefined;
  }
  const parsed = panelObjectRefSchema.safeParse(raw);
  return parsed.success ? placedObject(parsed.data) : undefined;
}

/** One availability question: a target with the parameters its binding gives there, and the row it came from. */
export interface AvailabilityCall {
  target: PanelOperationAvailabilityTarget;
  params: Readonly<Record<string, unknown>>;
  row?: PanelRecord;
}

/** Where the per-target facts come from: read for targets known now, the row record, or the list read's rows. */
export type FactsSource = { from: "targets"; targets: readonly PanelOperationAvailabilityTarget[] } | { from: "row" | "list" };

export interface AvailabilityPlan {
  reads: readonly RegisteredDataReadItem[];
  /** One refusal per call; the calls' targets are among the planned ones unless the facts come from rows or the list. */
  refuse(
    results: readonly JavaPanelReadResult[], calls: readonly AvailabilityCall[],
    carried?: (target: NonNullable<PanelOperationAvailabilityTarget>) => unknown,
  ): Promise<(PanelOperationRefusal | undefined)[]>;
}

function targetKey(target: PanelOperationAvailabilityTarget) {
  return target === null ? "" : JSON.stringify([target.objectType, target.primaryKey]);
}

function distinctTargets(targets: readonly PanelOperationAvailabilityTarget[]) {
  return [...new Map(targets.map(target => [targetKey(target), target])).values()];
}

export async function planAvailability(
  availability: PanelOperationAvailability, context: PanelOperationFactsContext, source: FactsSource,
): Promise<AvailabilityPlan> {
  const { shared } = availability;
  const sharedCount = shared?.reads.length ?? 0;
  const planned = source.from === "targets" ? distinctTargets(source.targets) : [];
  const read = source.from === "targets" && availability.read ? await availability.read(planned, context) : undefined;
  return {
    reads: [...shared?.reads ?? [], ...read?.reads ?? []],
    async refuse(results, calls, carried) {
      const sharedFacts = shared && await shared.facts(results.slice(0, sharedCount));
      let facts: readonly unknown[];
      if (source.from === "row") facts = calls.map(({ row }) => availability.row!(row!));
      else if (source.from === "list") facts = calls.map(({ target }) => carried!(target!));
      else if (read) {
        const byTarget = new Map((await read.facts(results.slice(sharedCount))).map((fact, index) => [targetKey(planned[index]!), fact]));
        facts = calls.map(({ target }) => byTarget.get(targetKey(target)));
      } else if (availability.local) {
        const targets = distinctTargets(calls.map(({ target }) => target));
        const local = await availability.local(targets, context, sharedFacts);
        const byTarget = new Map(targets.map((target, index) => [targetKey(target), local[index]]));
        facts = calls.map(({ target }) => byTarget.get(targetKey(target)));
      } else facts = calls.map(() => undefined);
      return calls.map(({ target, params }, index) => availability.refuse({
        shared: sharedFacts, facts: facts[index], target, params, locale: context.locale,
      }));
    },
  };
}

/**
 * A binding's refusal from its targets' refusals: one target's own, and for several targets the first one only when
 * every target is refused, because execution skips the refused items of a mixed selection.
 */
export function bindingRefusal(refusals: readonly (PanelOperationRefusal | undefined)[]) {
  return refusals.every(refusal => refusal !== undefined) ? refusals[0] : undefined;
}

/** Read the items of several plans as the person, without a placement, in one batch; each plan gets its own results. */
export async function readDirect(
  context: PanelOperationFactsContext, plans: readonly { reads: readonly RegisteredDataReadItem[] }[],
): Promise<JavaPanelReadResult[][]> {
  const items = plans.flatMap(plan => plan.reads);
  const results = items.length ? (await readViaJava(context.owner, items.map(item => ({
    source: { kind: "direct" as const }, ...javaReadItem(item),
  })), context.credentials)).results : [];
  let index = 0;
  return plans.map(plan => results.slice(index, index += plan.reads.length));
}

/** Decide one operation's availability for the calls now, reading its facts directly. */
export async function refuseDirect(
  availability: PanelOperationAvailability, context: PanelOperationFactsContext, calls: readonly AvailabilityCall[],
) {
  const plan = await planAvailability(availability, context, { from: "targets", targets: calls.map(({ target }) => target) });
  const [results] = await readDirect(context, [plan]);
  return plan.refuse(results!, calls);
}

/** Read an operation's input form directly. */
export async function readDirectInputSchema(
  form: PanelOperationInputForm, context: PanelOperationFactsContext,
): Promise<PanelOwnerOperationDescriptor["inputSchema"]> {
  const [results] = await readDirect(context, [form]);
  return form.schema(results!, context.locale);
}

interface RowOperation {
  bound: BoundProjectionOperation & { owner: NonNullable<BoundProjectionOperation["owner"]> };
  plan?: AvailabilityPlan;
}

function rowOperations(bounds: readonly BoundProjectionOperation[]): RowOperation["bound"][] {
  return bounds.flatMap(bound => {
    if (bound.binding.operation.kind !== "PlatformOperation" || !bound.owner) return [];
    const { binding, owner } = bound;
    // A fixed target without row parameters is decided once, with the operation's description.
    if (!rowTargetBinding(binding) && !(rowParamBinding(binding) && owner.handler.availability)) return [];
    return [{ ...bound, owner }];
  });
}

/** Each row's call of a row operation; a row without a target has none, and one the operation does not accept is refused. */
function rowEntries(
  { binding, owner }: RowOperation["bound"], rows: readonly PanelRecord[], rowType: string | undefined, inputs: Readonly<Record<string, unknown>>,
) {
  const known = new Map(Object.entries(inputs));
  return rows.flatMap(row => {
    const target = rowTargetForBinding(binding, row, rowType, inputs);
    if (target === undefined) return [];
    const compatible = target === null || operationAcceptsTargetType(target.objectType, owner.targetType, owner.declaration.targetTypes);
    return [{ rowKey: panelRowOperationKey(row, rowType), compatible, call: {
      target, row, params: resolvePinnedBoundParams(binding, known, target, row),
    } }];
  });
}

async function presentRows(
  operations: readonly RowOperation[], entries: readonly ReturnType<typeof rowEntries>[],
  results: readonly (readonly JavaPanelReadResult[])[], carried?: CarriedRowFacts,
): Promise<PanelRowOperationsMap | undefined> {
  const map: PanelRowOperationsMap = {};
  for (const [index, { bound: { name, owner }, plan }] of operations.entries()) {
    const calls = entries[index]!.filter(entry => entry.compatible).map(entry => entry.call);
    const refusals = plan && calls.length
      ? await plan.refuse(results[index]!, calls, carried && (target => carried(owner.handler.handlerRef, target)))
      : [];
    let next = 0;
    for (const { rowKey, compatible } of entries[index]!) {
      const refusal = compatible ? refusals[next++] : undefined;
      (map[rowKey] ??= {})[name] = !compatible ? { available: false }
        : refusal ? { available: false, unavailable: panelOperationUnavailableSchema.parse(refusal) } : { available: true };
    }
  }
  return Object.keys(map).length ? map : undefined;
}

/**
 * Plan the row availability of a formal list read before its rows are known. A row's facts come from the row record,
 * else from the list read, else from Node with the shared reads in the same second read. An operation that needs
 * per-target Java facts its list does not carry back is refused here, never shown as available. A fixed target with
 * row parameters is read now, like any known target.
 */
export async function planRowOperations(
  bounds: readonly BoundProjectionOperation[], inputs: Readonly<Record<string, unknown>>,
  context: PanelOperationFactsContext, listCarries: readonly string[],
) {
  const carried = new Set<string>();
  const operations = await Promise.all(rowOperations(bounds).map(async (bound): Promise<RowOperation> => {
    const { availability, handlerRef } = bound.owner.handler;
    if (!availability) return { bound };
    const { target } = bound.binding;
    if (!target || "literal" in target || "input" in target) {
      const fixed = target ? fixedTarget(target, inputs) : null;
      return fixed === undefined ? { bound }
        : { bound, plan: await planAvailability(availability, context, { from: "targets", targets: [fixed] }) };
    }
    if (availability.row) return { bound, plan: await planAvailability(availability, context, { from: "row" }) };
    if (listCarries.includes(handlerRef)) {
      carried.add(handlerRef);
      return { bound, plan: await planAvailability(availability, context, { from: "list" }) };
    }
    if (!availability.read) return { bound, plan: await planAvailability(availability, context, { from: "targets", targets: [] }) };
    throw new HttpError(422, `Operation '${handlerRef}' needs facts for each row that its list does not carry back`,
      "PANEL_OPERATION_READ_UNAVAILABLE");
  }));
  if (!operations.length) return;
  const reads = operations.map(({ plan }) => plan?.reads ?? []);
  return {
    carried: [...carried],
    reads: reads.flat(),
    present(results: readonly JavaPanelReadResult[], rows: readonly PanelRecord[], rowType: string | undefined, carriedFacts?: CarriedRowFacts) {
      if (!rows.length) return undefined;
      let index = 0;
      const own = reads.map(items => results.slice(index, index += items.length));
      return presentRows(operations, operations.map(({ bound }) => rowEntries(bound, rows, rowType, inputs)), own, carriedFacts);
    },
  };
}

/** The row availability of a list read outside a formal page: row facts, or one direct read for all rows' targets. */
export async function readDirectRowOperations(
  context: PanelOperationFactsContext, bounds: readonly BoundProjectionOperation[],
  inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[], rowType: string | undefined,
): Promise<PanelRowOperationsMap | undefined> {
  if (!rows.length) return undefined;
  const operated = rowOperations(bounds);
  if (!operated.length) return undefined;
  const entries = operated.map(bound => rowEntries(bound, rows, rowType, inputs));
  const operations = await Promise.all(operated.map(async (bound, index): Promise<RowOperation> => {
    const { availability } = bound.owner.handler;
    if (!availability) return { bound };
    if (availability.row && rowTargetBinding(bound.binding))
      return { bound, plan: await planAvailability(availability, context, { from: "row" }) };
    const targets = entries[index]!.filter(entry => entry.compatible).map(entry => entry.call.target);
    if (!targets.length) return { bound };
    return { bound, plan: await planAvailability(availability, context, { from: "targets", targets }) };
  }));
  const results = await readDirect(context, operations.map(({ plan }) => ({ reads: plan?.reads ?? [] })));
  return presentRows(operations, entries, results);
}
