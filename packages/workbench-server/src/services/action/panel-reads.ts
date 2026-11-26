import { z } from "zod";
import { sandboxCapabilitySchema } from "@ontomato/contracts/data-adapters";
import {
  actionBusinessMeaningSchema, actionCodeSegmentSchema, actionDefinitionSchema, actionExplanationSchema,
  type ActionCodeSegment, type ActionDefinition, type ActionExplanation, type ActionSegmentKind,
} from "@ontomato/contracts/action-panel";
import {
  annotatedCodeSchema, type AnnotatedCode, type AnnotatedCodeDetail, type AnnotatedCodeDetailPart,
  type AnnotatedCodeSegment, type AnnotatedCodeSummarySection, type AnnotatedCodeTone,
} from "@ontomato/contracts/annotated-code";
import { ACTION, DELETE_ACTION, SET_ACTION_STATUS, TRIAL_ACTION } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { UnavailableObjectAction } from "@ontomato/contracts/platform-type-table";
import type { PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import {
  panelFormDescriptionSchema, type PanelFieldTone, type PanelFormDescription, type PanelFormValues, type PanelRecord,
  type PanelRecordChildReferenceFieldValue, type PanelRecordFieldArrayItem, type PanelRecordFieldValue,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { createLogger } from "../../logging/logger";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/service-authentication";
import { objectActionDeclaration, readRefusal, storedObjectActionSchema } from "./object-actions";
import { sandboxPermissionPresentation } from "../product-panels/sandbox-permission";
import { operationHost } from "../product-panels/operation-host";
import { describeServerOperation, panelServerOperation } from "../product-panels/server-operations";

/*
 * The action catalog's named reads for a direct panel, read as the viewer: the list and one action as records, the
 * owner's definition form for one action, the definition the owner derives from its explained code and that
 * explanation, and the descriptions of the status change and the delete the panel offers,
 * described from their registered operations as every other platform operation is.
 * For an author's type table it also declares the published Actions that run on one customer object type.
 * The data engine answers the records' display names and the form in the reader's language; the column names are
 * this owner's text.
 */

const actionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  statusLabel: z.string().nullish(),
  trialStatus: z.enum(["passed", "failed", "notRun"]).nullish(),
  trialStatusLabel: z.string().nullish(),
  lastTrialAt: z.string().nullish(),
  lastTrialError: z.string().nullish(),
  publishBlockedCode: z.enum(["ACTION_EXPLANATION_REQUIRED", "ACTION_TRIAL_REQUIRED", "ACTION_TRIAL_FAILED"]).nullish(),
  publishBlockedReason: z.string().nullish(),
  origin: z.string().nullish(),
  originLabel: z.string().nullish(),
  createdByName: z.string().nullish(),
  modifyTimestamp: z.number().int().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
type ActionAsset = z.infer<typeof actionSchema>;

const actionCountSchema = z.object({ total: z.number().int().nonnegative() }).strict();

const logger = createLogger("action-panel-reads");
const listedActionSchema = storedObjectActionSchema.pick({ id: true }).extend({
  target: z.unknown(),
  function: z.unknown(),
});
const listedTargetSchema = storedObjectActionSchema.shape.target.unwrap().pick({ className: true });

/** One published Action for an author's type table: its target object type (or null when targetless), name, and declaration. */
export interface ObjectActionEntry {
  className: string | null;
  name: string;
  declaration: PanelOperationDeclaration;
  /** Customer object types declared in `definition.affects`, when present. */
  affects?: string[];
}

/** The stored fields of one action its explanation is read from; the data engine names each segment's kind. */
const explainedActionSchema = z.object({
  function: z.object({
    code: z.string().nullish(),
    parameters: z.array(z.object({ name: z.string().min(1) }).passthrough()).nullish(),
  }).passthrough().nullish(),
  definition: actionDefinitionSchema.nullish(),
  codeHash: z.string().nullish(),
  explanationVersion: z.number().int().nullish(),
  codeSegments: z.array(z.unknown()).nullish(),
  businessMeaning: z.unknown().optional(),
}).passthrough();

interface ActionFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

const EFFECT_GROUPS: readonly { key: string; labelKey: string; kinds: readonly string[] }[] = [
  { key: "create", labelKey: "panels.action.derived.groups.create", kinds: ["CREATE_OBJECT"] },
  { key: "update", labelKey: "panels.action.derived.groups.update", kinds: ["UPDATE_OBJECT"] },
  { key: "delete", labelKey: "panels.action.derived.groups.delete", kinds: ["DELETE_OBJECT"] },
  { key: "link", labelKey: "panels.action.derived.groups.link", kinds: ["CREATE_EDGE", "DELETE_EDGE"] },
  { key: "vector", labelKey: "panels.action.derived.groups.vector", kinds: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"] },
  { key: "other", labelKey: "panels.action.derived.groups.other", kinds: ["EXTERNAL_CALL"] },
];
const GROUP_OF_EFFECT_KIND = new Map(EFFECT_GROUPS.flatMap(group => group.kinds.map(kind => [kind, group.key])));

function actionStatusTone(status: string | null | undefined): PanelFieldTone | undefined {
  switch (status) {
    case "PUBLISHED": return "success";
    case "PENDING_REVIEW": return "warning";
    case "UNUSED": return "info";
    default: return undefined;
  }
}

function effectKindTone(kind: ActionSegmentKind): PanelFieldTone {
  switch (kind) {
    case "CREATE_OBJECT":
    case "CREATE_EDGE":
      return "success";
    case "DELETE_OBJECT":
    case "DELETE_EDGE":
    case "DELETE_VECTOR":
      return "danger";
    case "EXTERNAL_CALL":
      return "warning";
    default:
      return "info";
  }
}

function segmentKindTone(kind: ActionSegmentKind): AnnotatedCodeTone {
  switch (kind) {
    case "QUERY":
    case "COMPUTE":
      return "info";
    case "CREATE_OBJECT":
    case "CREATE_EDGE":
      return "success";
    case "UPDATE_OBJECT":
    case "APPEND_VECTOR":
    case "UPDATE_VECTOR":
      return "accent";
    case "DELETE_OBJECT":
    case "DELETE_EDGE":
    case "DELETE_VECTOR":
    case "ERROR_HANDLING":
      return "danger";
    case "EXTERNAL_CALL":
    case "BRANCH":
    case "LOOP":
    case "TRY_CATCH":
      return "warning";
    default:
      return "neutral";
  }
}

function formatJsonValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatGuardCondition(value: unknown, translate: (key: string) => string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return formatJsonValue(value);
  const condition = value as Record<string, unknown>;
  if (condition.properties && typeof condition.properties === "object") {
    return formatGuardCondition(condition.properties, translate);
  }
  if (condition.operator === "logic") {
    const and = Array.isArray(condition.and)
      ? condition.and.map(item => formatGuardCondition(item, translate)).filter(Boolean)
      : [];
    if (and.length > 0) return and.join(` ${translate("panels.action.derived.and")} `);
    const or = Array.isArray(condition.or)
      ? condition.or.map(item => formatGuardCondition(item, translate)).filter(Boolean)
      : [];
    if (or.length > 0) return or.join(` ${translate("panels.action.derived.or")} `);
    return "";
  }
  if (typeof condition.field === "string" && condition.field) {
    const operator = typeof condition.operator === "string" ? condition.operator : "";
    const operand = condition.value === undefined ? "" : ` ${formatJsonValue(condition.value)}`;
    return `${condition.field}${operator ? ` ${operator}` : ""}${operand}`.trim();
  }
  return formatJsonValue(value);
}

function formatAssignments(assignments: unknown): string {
  if (Array.isArray(assignments)) {
    const formatted = assignments
      .map(item => {
        if (item && typeof item === "object" && "field" in item && "valueFrom" in item) {
          return `${String(item.field)} ← ${String(item.valueFrom)}`;
        }
        return formatJsonValue(item);
      })
      .filter(Boolean);
    return formatted.join(" · ");
  }
  return formatJsonValue(assignments);
}

function buildParameterPattern(names: readonly string[]): RegExp | null {
  const unique = [...new Set(names.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return unique.length > 0 ? new RegExp(`\\b(${unique.join("|")})\\b`, "g") : null;
}

function splitReferenceParts(value: string, pattern: RegExp | null): AnnotatedCodeDetailPart[] {
  if (!pattern || !value) return [{ text: value }];
  const parts: AnnotatedCodeDetailPart[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: value.slice(cursor, start) });
    parts.push({ text: match[0], refKey: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: value }];
}

function splitParameterFieldValue(
  value: string,
  pattern: RegExp | null,
  primaryKey: string,
): PanelRecordFieldValue {
  if (!pattern || !value) return value;
  const parts: PanelRecordFieldArrayItem[] = [];
  let cursor = 0;
  let matched = false;
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push({
      kind: "child-reference",
      parent: { objectType: ACTION, primaryKey },
      collection: "parameters",
      primaryKey: match[0],
      label: match[0],
    });
    matched = true;
    cursor = start + match[0].length;
  }
  if (!matched) return value;
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function childSegmentsOf(segment: ActionCodeSegment): ActionCodeSegment[] {
  const children: ActionCodeSegment[] = [];
  if (Array.isArray(segment.segs)) children.push(...segment.segs);
  if (Array.isArray(segment.trySegs)) children.push(...segment.trySegs);
  for (const arm of segment.branchArms ?? []) {
    if (Array.isArray(arm.segs)) children.push(...arm.segs);
  }
  for (const handler of segment.catchs ?? []) {
    if (Array.isArray(handler.segs)) children.push(...handler.segs);
  }
  const maybeFinally = (segment as Record<string, unknown>).finallySegs;
  if (Array.isArray(maybeFinally)) {
    for (const candidate of maybeFinally) {
      const parsed = actionCodeSegmentSchema.safeParse(candidate);
      if (parsed.success) children.push(parsed.data);
    }
  }
  return children;
}

function collectSegmentParameterNames(
  segment: ActionCodeSegment,
  translate: (key: string) => string,
  paramPattern: RegExp,
): Set<string> {
  const matched = new Set<string>();
  for (const detail of segmentDetails(segment, translate, paramPattern)) {
    for (const part of detail.parts) {
      if (part.refKey) matched.add(part.refKey);
    }
  }
  const scan = (text: string | undefined) => {
    if (!text) return;
    paramPattern.lastIndex = 0;
    for (const match of text.matchAll(paramPattern)) {
      matched.add(match[0]);
    }
  };
  for (const arm of segment.branchArms ?? []) {
    scan(arm.condition);
  }
  const maybeExpression = (segment as Record<string, unknown>).expression;
  if (typeof maybeExpression === "string") scan(maybeExpression);
  return matched;
}

function collectParameterCodeLocations(
  segments: readonly ActionCodeSegment[],
  translate: (key: string) => string,
  paramPattern: RegExp | null,
  primaryKey: string,
): Map<string, PanelRecordChildReferenceFieldValue[]> {
  const locations = new Map<string, PanelRecordChildReferenceFieldValue[]>();
  if (!paramPattern || segments.length === 0) return locations;
  const seenByParam = new Map<string, Set<string>>();
  const visit = (segment: ActionCodeSegment) => {
    const start = segment.codeRange.start;
    const end = Math.max(start, segment.codeRange.end);
    for (const paramName of collectSegmentParameterNames(segment, translate, paramPattern)) {
      let seen = seenByParam.get(paramName);
      if (!seen) {
        seen = new Set<string>();
        seenByParam.set(paramName, seen);
      }
      if (seen.has(segment.id)) continue;
      seen.add(segment.id);
      const bucket = locations.get(paramName) ?? [];
      bucket.push({
        kind: "child-reference",
        parent: { objectType: ACTION, primaryKey },
        collection: "codeSegments",
        primaryKey: segment.id,
        label: `${segment.title} (L${start}–${end})`,
      });
      locations.set(paramName, bucket);
    }
    for (const child of childSegmentsOf(segment)) {
      visit(child);
    }
  };
  for (const segment of segments) visit(segment);
  return locations;
}

function segmentDetails(
  segment: ActionCodeSegment,
  translate: (key: string) => string,
  paramPattern: RegExp | null,
): AnnotatedCodeDetail[] {
  const rows: AnnotatedCodeDetail[] = [];
  const add = (labelKey: string, value: unknown) => {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
    const text = typeof value === "string" ? value : formatJsonValue(value);
    if (!text) return;
    rows.push({
      label: translate(labelKey),
      parts: splitReferenceParts(text, paramPattern),
    });
  };
  add("panels.action.explanation.details.class", segment.class);
  add("panels.action.explanation.details.sourceClass", segment.sourceClass);
  add("panels.action.explanation.details.targetClass", segment.targetClass);
  add("panels.action.explanation.details.relation", segment.relation);
  if (Array.isArray(segment.assignments) && segment.assignments.length > 0) {
    add("panels.action.explanation.details.fields", formatAssignments(segment.assignments));
  }
  add("panels.action.explanation.details.checks", segment.conditions);
  add("panels.action.explanation.details.objectFrom", segment.objectIdFrom);
  add("panels.action.explanation.details.sourceFrom", segment.sourceObjectIdFrom);
  add("panels.action.explanation.details.targetFrom", segment.targetObjectIdFrom);
  add("panels.action.explanation.details.textFrom", segment.textFrom);
  add("panels.action.explanation.details.fileFrom", segment.fileIdFrom);

  const filters = segment.filters && typeof segment.filters === "object" ? segment.filters as Record<string, unknown> : null;
  const objects = Array.isArray(filters?.objects) ? filters.objects : [];
  if (objects.length > 0) {
    const formattedObjects = objects
      .map(item => {
        if (!item || typeof item !== "object") return formatJsonValue(item);
        const obj = item as Record<string, unknown>;
        return [obj.alias, obj.class].filter(Boolean).map(String).join(" · ");
      })
      .filter(Boolean)
      .join(" | ");
    add("panels.action.explanation.details.objects", formattedObjects);
    for (const item of objects) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (obj.conditions !== undefined && obj.conditions !== null) {
        add(
          "panels.action.explanation.details.checks",
          [obj.alias ? String(obj.alias) : "", formatJsonValue(obj.conditions)].filter(Boolean).join(": "),
        );
      }
    }
  }
  const relations = Array.isArray(filters?.relationship) ? filters.relationship : [];
  if (relations.length > 0) {
    const formattedRelations = relations
      .map(item => {
        if (!item || typeof item !== "object") return formatJsonValue(item);
        const rel = item as Record<string, unknown>;
        return `${String(rel.from ?? "?")} —${String(rel.type ?? "")}→ ${String(rel.to ?? "?")}`;
      })
      .filter(Boolean)
      .join(" | ");
    add("panels.action.explanation.details.relation", formattedRelations);
  }
  const output = segment.output && typeof segment.output === "object" ? segment.output as Record<string, unknown> : null;
  if (output && Array.isArray(output.fields) && output.fields.length > 0) {
    add(
      "panels.action.explanation.details.outputFields",
      output.fields.map(item => (typeof item === "string" ? item : formatJsonValue(item))).join(" · "),
    );
  }
  add("panels.action.explanation.details.groupBy", output?.group_by);
  add("panels.action.explanation.details.sortBy", output?.sort);
  add("panels.action.explanation.details.limit", output?.limit);
  return rows;
}

function mapAnnotatedSegment(
  segment: ActionCodeSegment,
  translate: (key: string) => string,
  paramPattern: RegExp | null,
): AnnotatedCodeSegment {
  const details = segmentDetails(segment, translate, paramPattern);
  const children = childSegmentsOf(segment).map(child => mapAnnotatedSegment(child, translate, paramPattern));
  const start = segment.codeRange.start;
  const end = Math.max(start, segment.codeRange.end);
  return {
    id: segment.id,
    kind: segment.kind,
    kindLabel: segment.kindLabel,
    title: segment.title,
    lineRange: { start, end },
    tone: segmentKindTone(segment.kind),
    ...(typeof segment.narrative === "string" && segment.narrative.length > 0 ? { note: segment.narrative } : {}),
    ...(details.length > 0 ? { details } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function actionTrialOutputs(action: ActionAsset) {
  return {
    actionStatus: action.status ?? null,
    trialStatus: action.trialStatus ?? "notRun",
    trialStatusLabel: action.trialStatusLabel ?? null,
    lastTrialAt: action.lastTrialAt ?? null,
    lastTrialError: action.lastTrialError ?? null,
    publishBlockedCode: action.publishBlockedCode ?? null,
    publishBlockedReason: action.publishBlockedReason ?? null,
  };
}

function actionRecord(action: ActionAsset, fieldLabels: Record<string, string>): PanelRecord {
  const statusTone = actionStatusTone(action.status);
  const description = action.description?.trim() ?? "";
  return {
    primaryKey: action.id,
    label: action.name,
    ...(description ? { subtitle: description } : {}),
    fieldLabels,
    fields: {
      status: action.statusLabel ?? "",
      origin: action.originLabel ?? "",
      createdBy: action.createdByName ?? "",
      reviewedBy: action.reviewedByName ?? "",
      function: action.function?.name ?? "",
      updatedAt: action.modifyTimestamp == null ? "" : new Date(action.modifyTimestamp).toISOString(),
    },
    ...(statusTone ? { tones: { status: statusTone } } : {}),
    outputs: actionTrialOutputs(action),
  };
}

/** One read from the action owner as the viewer: its envelope's data checked against the schema, or its refusal. */
function actionOwner(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  return async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = body === undefined
      ? await backendGet(name, base + path, options)
      : await backendPost(name, base + path, body, options);
    const envelope = ownerEnvelopeSchema.parse(JSON.parse(response.text));
    if (!envelope.success) throw readRefusal(envelope, "ACTION_READ_FAILED", "The owner could not read the actions");
    return schema.parse(envelope.data);
  };
}

/** The object Actions an author's type table declares, and the published ones it cannot, each with the reason. */
export interface ObjectActionCatalog {
  actions: ObjectActionEntry[];
  unavailableActions: UnavailableObjectAction[];
}

/**
 * The published Actions of the viewer's domain that run on an object, each with the object type its stored target
 * names, its stored name and its static declaration; with an object type, only that type's. One owner read serves a
 * whole type table. It needs only the viewer's verified credentials: the owner reads the domain and judges the grants.
 */
export async function readObjectActions(viewer: AssistantCredentials, objectType?: string): Promise<ObjectActionCatalog> {
  const owner = actionOwner(viewer);
  const published = await owner("action-object-catalog", "/action/queryList", { purpose: "execute", status: "PUBLISHED" }, z.array(z.unknown()));
  const actions: ObjectActionEntry[] = [];
  const unavailableActions: UnavailableObjectAction[] = [];
  for (const raw of published) {
    const listed = listedActionSchema.safeParse(raw);
    if (!listed.success) {
      logger.warn("The action owner returned a published record without a usable ID");
      continue;
    }
    const { id, target, function: storedFunction } = listed.data;
    const classified = listedTargetSchema.safeParse(target);
    const actualType = classified.success ? classified.data.className : undefined;
    if (objectType !== undefined && objectType !== actualType) continue;
    const identity = { id, ...(actualType === undefined ? {} : { objectType: actualType }) };

    if (storedFunction == null) {
      unavailableActions.push({ ...identity, reason: "The stored function definition is missing." });
      continue;
    }
    const stored = storedObjectActionSchema.safeParse(raw);
    if (!stored.success) {
      const issue = stored.error.issues[0]!;
      const field = issue.path.length ? `field '${issue.path.join(".")}'` : "definition";
      unavailableActions.push({ ...identity, reason: `Invalid stored action ${field}: ${issue.message}` });
      continue;
    }
    const action = stored.data;
    const affects = [...new Set(action.definition?.affects ?? [])];
    actions.push({
      className: action.target?.className ?? null,
      name: action.name,
      declaration: objectActionDeclaration(action),
      ...(affects.length > 0 && { affects }),
    });
  }
  return { actions, unavailableActions };
}

export function createActionReadAdapter(reader: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const owner = actionOwner(viewer);
  const readActions = () => owner("action-list", "/action/queryList", {}, z.array(actionSchema));
  const translate = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => Object.fromEntries(
    ["status", "origin", "createdBy", "reviewedBy", "function", "updatedAt"]
      .map(name => [name, translate(`panels.action.fields.${name}`)]),
  );
  function definitionForm(name: string, target: PanelFormTarget, { values, changedField }: ActionFormParams) {
    return owner(name, "/action/definitionForm", {
      target, ...(values !== undefined && { values }), changedField: changedField ?? null,
    }, panelFormDescriptionSchema);
  }
  return {
    async sandboxCapability(): Promise<PanelRecord> {
      const { status, supported, canCreateAndDrop, reason, probeNote } =
        await owner("action-sandbox-capability", "/action/sandboxCapability", undefined, sandboxCapabilitySchema);
      const sandbox = sandboxPermissionPresentation({ status, reason }, viewer.locale);
      return {
        primaryKey: "domain",
        label: translate("panels.dataAdapters.sandbox.title"),
        fields: { sandboxStatus: sandbox.status, sandboxDetail: sandbox.detail },
        fieldLabels: {
          sandboxStatus: translate("panels.dataAdapters.sandbox.status"),
          sandboxDetail: translate("panels.dataAdapters.sandbox.detail"),
        },
        tones: { sandboxStatus: sandbox.tone },
        outputs: {
          sandboxStatus: status,
          sandboxSupported: supported,
          sandboxCanCreateAndDrop: canCreateAndDrop,
          sandboxReason: reason,
          sandboxProbeNote: probeNote,
        },
      };
    },
    async list(): Promise<PanelRecord[]> {
      const labels = fieldLabels();
      return (await readActions()).map(action => actionRecord(action, labels));
    },
    async count() {
      const { total } = await owner("action-count", "/action/queryList", { countOnly: true }, actionCountSchema);
      return { rows: [], total };
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return actionRecord(await owner("action-record", "/action/queryById", { id: primaryKey }, actionSchema), fieldLabels());
    },
    async trialSummary(primaryKey: string): Promise<PanelRecord> {
      const action = await owner("action-trial-summary", "/action/queryById", { id: primaryKey }, actionSchema);
      const outputs = actionTrialOutputs(action);
      const { actionStatus, trialStatus, trialStatusLabel, lastTrialAt, lastTrialError, publishBlockedCode, publishBlockedReason } = outputs;
      const trialText = (key: string) => translate(`panels.action.trial.${key}`);
      const publishedOrReady = actionStatus === "PUBLISHED" ? trialText("alreadyPublished")
        : trialStatus === "passed" && !publishBlockedCode ? trialText("readyToPublish") : "";
      const trialDetail = (trialStatus === "failed" ? lastTrialError : null) ?? publishBlockedReason ?? publishedOrReady;
      return {
        primaryKey: action.id,
        label: action.name,
        fieldLabels: {
          trialStatus: trialText("fields.status"),
          lastTrialAt: trialText("fields.testedAt"),
          trialDetail: trialText("fields.detail"),
        },
        fields: { trialStatus: trialStatusLabel ?? trialText(trialStatus), lastTrialAt: lastTrialAt ?? "—", trialDetail },
        tones: { trialStatus: trialStatus === "passed" ? "success" : trialStatus === "failed" ? "danger" : "warning" },
        outputs,
      };
    },
    async form(primaryKey: string, params: ActionFormParams): Promise<PanelFormDescription> {
      return definitionForm("action-form", { kind: "object", objectType: ACTION, primaryKey }, params);
    },
    /** What the data engine derives from the action's explained code: what it writes, reads, takes and checks. */
    async definition(primaryKey: string): Promise<ActionDefinition> {
      const action = await owner("action-definition", "/action/queryById", { id: primaryKey },
        z.object({ definition: actionDefinitionSchema }).passthrough());
      return action.definition;
    },
    /**
     * Standard summary record for the action's derived definition: unverified status, declared target, affected object
     * types, and curated business meaning (suppressing redundant operation summary when derived rules are present while
     * preserving negative effect).
     */
    async derivedSummary(primaryKey: string): Promise<PanelRecord> {
      const action = await owner("action-derived-summary", "/action/queryById", { id: primaryKey },
        explainedActionSchema.extend({ definition: actionDefinitionSchema }));
      const definition = action.definition;
      const affects = definition.affects ?? [];
      const description = definition.description?.trim() ?? "";
      const declaredTarget = definition.declaredTarget
        ? `${definition.declaredTarget.className} ← ${definition.declaredTarget.keyParameter}`
        : translate("panels.action.derived.noTarget");
      const hasRules = (definition.effects?.length ?? 0) > 0;
      const parsedMeaning = action.businessMeaning != null
        ? actionBusinessMeaningSchema.safeParse(action.businessMeaning)
        : null;
      const meaning = parsedMeaning?.success ? parsedMeaning.data : null;
      const curatedOperations = !hasRules && meaning
        ? meaning.operations.map(item => item.trim()).filter(Boolean)
        : [];
      const negativeEffect = meaning ? meaning.negativeEffect.trim() : "";
      return {
        primaryKey,
        label: definition.name,
        ...(description ? { subtitle: description } : {}),
        fieldLabels: {
          derivationStatus: translate("panels.action.derived.fields.derivationStatus"),
          declaredTarget: translate("panels.action.derived.fields.declaredTarget"),
          affects: translate("panels.action.derived.fields.affects"),
          ...(curatedOperations.length > 0
            ? { businessOperations: translate("panels.action.explanation.summary.operations") }
            : {}),
          ...(negativeEffect
            ? { negativeEffect: translate("panels.action.explanation.summary.negativeEffect") }
            : {}),
        },
        fields: {
          derivationStatus: translate("panels.action.derived.unverified"),
          declaredTarget,
          ...(affects.length === 0 ? { affects: translate("panels.action.derived.noAffects") } : {}),
          ...(curatedOperations.length > 0
            ? { businessOperations: curatedOperations.map(item => `• ${item}`).join("\n") }
            : {}),
          ...(negativeEffect ? { negativeEffect } : {}),
        },
        tones: {
          derivationStatus: "info",
          ...(negativeEffect ? { negativeEffect: "warning" as const } : {}),
        },
        ...(affects.length > 0 ? { tags: { affects } } : {}),
      };
    },
    /** Standard record list of derived effects ordered by semantic group (create, update, delete, link, vector, other). */
    async derivedEffects(primaryKey: string): Promise<PanelRecord[]> {
      const action = await owner("action-derived-effects", "/action/queryById", { id: primaryKey },
        explainedActionSchema.extend({ definition: actionDefinitionSchema }));
      const effects = action.definition.effects ?? [];
      if (effects.length === 0) return [];
      const parameterNames = (action.definition.parameters ?? action.function?.parameters ?? []).map(parameter => parameter.name);
      const paramPattern = buildParameterPattern(parameterNames);
      const buckets = new Map<string, NonNullable<ActionDefinition["effects"]>>();
      for (const effect of effects) {
        const key = GROUP_OF_EFFECT_KIND.get(effect.kind) ?? "other";
        const bucket = buckets.get(key) ?? [];
        bucket.push(effect);
        buckets.set(key, bucket);
      }
      const effectFieldLabels = {
        group: translate("panels.action.derived.fields.group"),
        kind: translate("panels.action.derived.fields.kind"),
        target: translate("panels.action.derived.fields.target"),
        fields: translate("panels.action.derived.fields.fields"),
        guards: translate("panels.action.derived.fields.guards"),
        locate: translate("panels.action.derived.fields.locate"),
      };
      const objectWord = translate("panels.action.derived.targetObject");
      const sourceWord = translate("panels.action.derived.targetSource");
      const targetWord = translate("panels.action.derived.targetTarget");
      const textWord = translate("panels.action.derived.targetText");
      const fileWord = translate("panels.action.derived.targetFile");
      const rows: PanelRecord[] = [];
      for (const group of EFFECT_GROUPS) {
        const items = buckets.get(group.key);
        if (!items?.length) continue;
        const groupLabel = translate(group.labelKey);
        for (let index = 0; index < items.length; index++) {
          const effect = items[index]!;
          const targetParts: string[] = [];
          if (effect.relation) {
            targetParts.push(`${effect.sourceClass ?? "?"} —${effect.relation}→ ${effect.targetClass ?? "?"}`);
          } else {
            if (effect.className) targetParts.push(effect.className);
            if (effect.sourceClass || effect.targetClass) {
              targetParts.push(`${effect.sourceClass ?? "?"} → ${effect.targetClass ?? "?"}`);
            }
          }
          if (effect.attrName) targetParts.push(effect.attrName);
          const locateParts: string[] = [];
          if (effect.objectIdFrom) locateParts.push(`${objectWord} ← ${effect.objectIdFrom}`);
          if (effect.sourceObjectIdFrom) locateParts.push(`${sourceWord} ← ${effect.sourceObjectIdFrom}`);
          if (effect.targetObjectIdFrom) locateParts.push(`${targetWord} ← ${effect.targetObjectIdFrom}`);
          if (effect.textFrom) locateParts.push(`${textWord} ← ${effect.textFrom}`);
          if (effect.fileIdFrom) locateParts.push(`${fileWord} ← ${effect.fileIdFrom}`);
          const narrative = effect.narrative?.trim() ?? "";
          rows.push({
            primaryKey: `effect-${group.key}-${index}`,
            label: effect.title?.trim() || effect.kindLabel,
            ...(narrative ? { subtitle: narrative } : {}),
            fieldLabels: effectFieldLabels,
            fields: {
              group: groupLabel,
              kind: effect.kindLabel,
              target: splitParameterFieldValue(targetParts.join(" · "), paramPattern, primaryKey),
              fields: splitParameterFieldValue(formatAssignments(effect.assignments), paramPattern, primaryKey),
              guards: splitParameterFieldValue(formatGuardCondition(effect.guards, translate), paramPattern, primaryKey),
              locate: splitParameterFieldValue(locateParts.join(" · "), paramPattern, primaryKey),
            },
            tones: { kind: effectKindTone(effect.kind) },
          });
        }
      }
      return rows;
    },
    /** Standard record list of derived parameters keyed by parameter name for cross-tab reference highlighting. */
    async derivedParameters(primaryKey: string): Promise<PanelRecord[]> {
      const action = await owner("action-derived-parameters", "/action/queryById", { id: primaryKey },
        explainedActionSchema.extend({ definition: actionDefinitionSchema }));
      const parameters = action.definition.parameters ?? [];
      if (parameters.length === 0) return [];
      const paramPattern = buildParameterPattern(parameters.map(parameter => parameter.name));
      const parsedSegments = z.array(actionCodeSegmentSchema).parse(action.codeSegments ?? []);
      const codeLocationsByParam = collectParameterCodeLocations(parsedSegments, translate, paramPattern, primaryKey);
      const paramFieldLabels = {
        type: translate("panels.action.derived.fields.paramType"),
        required: translate("panels.action.derived.fields.required"),
        objectTypes: translate("panels.action.derived.fields.objectTypes"),
        sample: translate("panels.action.derived.fields.sample"),
        constraints: translate("panels.action.derived.fields.constraints"),
        codeLocations: translate("panels.action.derived.fields.codeLocations"),
      };
      const yesLabel = translate("panels.action.derived.yes");
      const noLabel = translate("panels.action.derived.no");
      return parameters.map(parameter => {
        const objectTypes = parameter.objectTypes ?? [];
        const required = parameter.required == null ? "" : (parameter.required ? yesLabel : noLabel);
        const description = parameter.description?.trim() ?? "";
        const codeLocations = codeLocationsByParam.get(parameter.name);
        return {
          primaryKey: parameter.name,
          label: parameter.name,
          ...(description ? { subtitle: description } : {}),
          fieldLabels: paramFieldLabels,
          fields: {
            type: parameter.type,
            required,
            ...(objectTypes.length === 0 ? { objectTypes: "" } : {}),
            sample: formatJsonValue(parameter.sample),
            constraints: formatJsonValue(parameter.constraints),
            ...(codeLocations && codeLocations.length > 0 ? { codeLocations } : {}),
          },
          ...(objectTypes.length > 0 ? { tags: { objectTypes } } : {}),
        };
      });
    },
    /** Standard record list of derived submission conditions and unrepresentable custom checks. */
    async derivedConditions(primaryKey: string): Promise<PanelRecord[]> {
      const action = await owner("action-derived-conditions", "/action/queryById", { id: primaryKey },
        explainedActionSchema.extend({ definition: actionDefinitionSchema }));
      const criteria = action.definition.submissionCriteria;
      const conditions = criteria?.conditions ?? [];
      const rawUnrepresentable = Array.isArray((criteria as Record<string, unknown> | undefined)?.unrepresentable)
        ? ((criteria as Record<string, unknown>).unrepresentable as unknown[])
        : [];
      const customChecks = rawUnrepresentable.filter((item): item is { description?: unknown; reason?: unknown } =>
        Boolean(item && typeof item === "object" && (
          ("description" in item && Boolean((item as Record<string, unknown>).description))
          || ("reason" in item && Boolean((item as Record<string, unknown>).reason))
        )),
      );
      if (conditions.length === 0 && customChecks.length === 0) return [];
      const parameterNames = (action.definition.parameters ?? action.function?.parameters ?? []).map(parameter => parameter.name);
      const paramPattern = buildParameterPattern(parameterNames);
      const conditionFieldLabels = {
        kind: translate("panels.action.derived.fields.conditionKind"),
        join: translate("panels.action.derived.fields.conditionJoin"),
        expression: translate("panels.action.derived.fields.conditionExpression"),
        detail: translate("panels.action.derived.fields.conditionDetail"),
      };
      const joinLabel = String((criteria as Record<string, unknown> | undefined)?.operator ?? "").toUpperCase() === "OR"
        ? translate("panels.action.derived.or")
        : translate("panels.action.derived.and");
      const ruleKindLabel = translate("panels.action.derived.conditionKind.rule");
      const customKindLabel = translate("panels.action.derived.conditionKind.custom");
      const rows: PanelRecord[] = [];
      for (let index = 0; index < conditions.length; index++) {
        const condition = conditions[index]!;
        const subject = [condition.className, condition.field].filter(Boolean).join(".");
        const expression = [
          condition.objectParameter,
          subject,
          condition.operator,
          formatJsonValue(condition.value),
        ].filter(Boolean).join(" ");
        const detail = condition.message || condition.failureMessage || condition.description || "";
        const label = expression || detail || `#${index + 1}`;
        rows.push({
          primaryKey: `condition-${index}`,
          label,
          ...(detail && detail !== label ? { subtitle: detail } : {}),
          fieldLabels: conditionFieldLabels,
          fields: {
            kind: ruleKindLabel,
            join: conditions.length > 1 ? joinLabel : "",
            expression: splitParameterFieldValue(label, paramPattern, primaryKey),
            detail: splitParameterFieldValue(detail, paramPattern, primaryKey),
          },
          tones: { kind: "info" },
        });
      }
      for (let index = 0; index < customChecks.length; index++) {
        const check = customChecks[index]!;
        const description = typeof check.description === "string" ? check.description : formatJsonValue(check.description);
        const reason = typeof check.reason === "string" ? check.reason : formatJsonValue(check.reason);
        const label = description || reason;
        rows.push({
          primaryKey: `custom-${index}`,
          label,
          ...(description && reason ? { subtitle: reason } : {}),
          fieldLabels: conditionFieldLabels,
          fields: {
            kind: customKindLabel,
            join: "",
            expression: splitParameterFieldValue(label, paramPattern, primaryKey),
            detail: splitParameterFieldValue(reason, paramPattern, primaryKey),
          },
          tones: { kind: "warning" },
        });
      }
      return rows;
    },
    /** The saved code and its explanation; an action saved before it was explained has no segments yet. */
    async explanation(primaryKey: string): Promise<ActionExplanation> {
      const action = await owner("action-explanation", "/action/queryById", { id: primaryKey }, explainedActionSchema);
      return actionExplanationSchema.parse({
        ...(action.function?.code != null && { code: action.function.code }),
        ...(action.codeHash != null && { codeHash: action.codeHash }),
        ...(action.explanationVersion != null && { explanationVersion: action.explanationVersion }),
        codeSegments: action.codeSegments ?? [],
        ...(action.businessMeaning != null && { businessMeaning: action.businessMeaning }),
      });
    },
    /** Standard annotatedCode projection of the saved code, hierarchical segments with parameter refs, and business meaning. */
    async annotatedExplanation(primaryKey: string): Promise<AnnotatedCode> {
      const action = await owner("action-annotated-explanation", "/action/queryById", { id: primaryKey }, explainedActionSchema);
      const parameterNames = (action.definition?.parameters ?? action.function?.parameters ?? []).map(parameter => parameter.name);
      const paramPattern = buildParameterPattern(parameterNames);
      const parsedSegments = z.array(actionCodeSegmentSchema).parse(action.codeSegments ?? []);
      const segments = parsedSegments.map(segment => mapAnnotatedSegment(segment, translate, paramPattern));
      const summary: AnnotatedCodeSummarySection[] = [];
      if (action.businessMeaning != null) {
        const meaning = actionBusinessMeaningSchema.parse(action.businessMeaning);
        if (meaning.operations.length > 0) {
          summary.push({
            title: translate("panels.action.explanation.summary.operations"),
            kind: "list",
            items: meaning.operations,
          });
        }
        if (meaning.negativeEffect.trim().length > 0) {
          summary.push({
            title: translate("panels.action.explanation.summary.negativeEffect"),
            kind: "text",
            text: meaning.negativeEffect,
            tone: "warning",
          });
        }
      }
      return annotatedCodeSchema.parse({
        ...(action.function?.code != null && { code: action.function.code }),
        language: "python",
        segments,
        ...(summary.length > 0 && { summary }),
      });
    },
    /** The owner's form for a new action draft. */
    async createForm(params: ActionFormParams): Promise<PanelFormDescription> {
      return definitionForm("action-create-form", { kind: "draft" }, params);
    },
    /** The published object Actions for an author's type table: `readObjectActions` as this viewer. */
    objectActions: (objectType?: string) => readObjectActions(viewer, objectType),
    [`${SET_ACTION_STATUS}.describe`]() {
      return describeServerOperation(panelServerOperation(SET_ACTION_STATUS), operationHost({ owner: reader, credentials: viewer }));
    },
    [`${TRIAL_ACTION}.describe`]() {
      return describeServerOperation(panelServerOperation(TRIAL_ACTION), operationHost({ owner: reader, credentials: viewer }));
    },
    [`${DELETE_ACTION}.describe`]() {
      return describeServerOperation(panelServerOperation(DELETE_ACTION), operationHost({ owner: reader, credentials: viewer }));
    },
  };
}
