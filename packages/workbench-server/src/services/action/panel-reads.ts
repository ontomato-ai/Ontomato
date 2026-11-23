import { z } from "zod";
import {
  actionBusinessMeaningSchema, actionCodeSegmentSchema, actionDefinitionSchema, actionExplanationSchema,
  type ActionCodeSegment, type ActionDefinition, type ActionExplanation, type ActionSegmentKind,
} from "@ontomato/contracts/action-panel";
import {
  annotatedCodeSchema, type AnnotatedCode, type AnnotatedCodeDetail, type AnnotatedCodeDetailPart,
  type AnnotatedCodeSegment, type AnnotatedCodeSummarySection, type AnnotatedCodeTone,
} from "@ontomato/contracts/annotated-code";
import { ACTION, DELETE_ACTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { UnavailableObjectAction } from "@ontomato/contracts/platform-type-table";
import type { PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import {
  panelFormDescriptionSchema, type PanelFieldTone, type PanelFormDescription, type PanelFormValues, type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { createLogger } from "../../logging/logger";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";
import { objectActionDeclaration, readRefusal, storedObjectActionSchema } from "./object-actions";
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
  origin: z.string().nullish(),
  originLabel: z.string().nullish(),
  createdByName: z.string().nullish(),
  modifyTimestamp: z.number().int().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
type ActionAsset = z.infer<typeof actionSchema>;

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
  const rawChildren: ActionCodeSegment[] = [];
  if (Array.isArray(segment.segs)) rawChildren.push(...segment.segs);
  if (Array.isArray(segment.trySegs)) rawChildren.push(...segment.trySegs);
  for (const arm of segment.branchArms ?? []) {
    if (Array.isArray(arm.segs)) rawChildren.push(...arm.segs);
  }
  for (const handler of segment.catchs ?? []) {
    if (Array.isArray(handler.segs)) rawChildren.push(...handler.segs);
  }
  const maybeFinally = (segment as Record<string, unknown>).finallySegs;
  if (Array.isArray(maybeFinally)) {
    for (const candidate of maybeFinally) {
      const parsed = actionCodeSegmentSchema.safeParse(candidate);
      if (parsed.success) rawChildren.push(parsed.data);
    }
  }
  const children = rawChildren.map(child => mapAnnotatedSegment(child, translate, paramPattern));
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

function actionRecord(action: ActionAsset, fieldLabels: Record<string, string>): PanelRecord {
  const statusTone = actionStatusTone(action.status);
  return {
    primaryKey: action.id,
    label: action.name,
    ...(action.description ? { subtitle: action.description } : {}),
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
  };
}

/** One read from the action owner as the viewer: its envelope's data checked against the schema, or its refusal. */
function actionOwner(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  return async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
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
  const published = await owner("action-object-catalog", "/action/queryList", { status: "PUBLISHED" }, z.array(z.unknown()));
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

export function createActionReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
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
    async list(): Promise<PanelRecord[]> {
      const labels = fieldLabels();
      return (await readActions()).map(action => actionRecord(action, labels));
    },
    async count() {
      return { rows: [], total: (await readActions()).length };
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return actionRecord(await owner("action-record", "/action/queryById", { id: primaryKey }, actionSchema), fieldLabels());
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
    /** Standard summary record for the action's derived definition (declared target and affected object types). */
    async derivedSummary(primaryKey: string): Promise<PanelRecord> {
      const action = await owner("action-derived-summary", "/action/queryById", { id: primaryKey },
        z.object({ definition: actionDefinitionSchema }).passthrough());
      const definition = action.definition;
      const affects = definition.affects ?? [];
      const declaredTarget = definition.declaredTarget
        ? `${definition.declaredTarget.className} ← ${definition.declaredTarget.keyParameter}`
        : translate("panels.action.derived.noTarget");
      return {
        primaryKey,
        label: definition.name,
        ...(definition.description ? { subtitle: definition.description } : {}),
        fieldLabels: {
          declaredTarget: translate("panels.action.derived.fields.declaredTarget"),
          affects: translate("panels.action.derived.fields.affects"),
        },
        fields: {
          declaredTarget,
          ...(affects.length === 0 ? { affects: translate("panels.action.derived.noAffects") } : {}),
        },
        ...(affects.length > 0 ? { tags: { affects } } : {}),
      };
    },
    /** Standard record list of derived effects ordered by semantic group (create, update, delete, link, vector, other). */
    async derivedEffects(primaryKey: string): Promise<PanelRecord[]> {
      const action = await owner("action-derived-effects", "/action/queryById", { id: primaryKey },
        z.object({ definition: actionDefinitionSchema }).passthrough());
      const effects = action.definition.effects ?? [];
      if (effects.length === 0) return [];
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
      };
      const objectWord = translate("panels.action.derived.targetObject");
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
          if (effect.className) targetParts.push(effect.className);
          if (effect.relation) targetParts.push(effect.relation);
          if (effect.sourceClass || effect.targetClass) {
            targetParts.push(`${effect.sourceClass ?? "?"} → ${effect.targetClass ?? "?"}`);
          }
          if (effect.objectIdFrom) targetParts.push(`${objectWord} ← ${effect.objectIdFrom}`);
          if (effect.sourceObjectIdFrom) targetParts.push(`← ${effect.sourceObjectIdFrom}`);
          if (effect.targetObjectIdFrom) targetParts.push(`→ ${effect.targetObjectIdFrom}`);
          if (effect.attrName) targetParts.push(effect.attrName);
          if (effect.textFrom) targetParts.push(`${textWord} ← ${effect.textFrom}`);
          if (effect.fileIdFrom) targetParts.push(`${fileWord} ← ${effect.fileIdFrom}`);
          rows.push({
            primaryKey: `effect-${group.key}-${index}`,
            label: effect.title?.trim() || effect.kindLabel,
            ...(effect.narrative ? { subtitle: effect.narrative } : {}),
            fieldLabels: effectFieldLabels,
            fields: {
              group: groupLabel,
              kind: effect.kindLabel,
              target: targetParts.join(" · "),
              fields: formatAssignments(effect.assignments),
              guards: formatJsonValue(effect.guards),
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
        z.object({ definition: actionDefinitionSchema }).passthrough());
      const parameters = action.definition.parameters ?? [];
      if (parameters.length === 0) return [];
      const paramFieldLabels = {
        type: translate("panels.action.derived.fields.paramType"),
        required: translate("panels.action.derived.fields.required"),
        objectTypes: translate("panels.action.derived.fields.objectTypes"),
        sample: translate("panels.action.derived.fields.sample"),
        constraints: translate("panels.action.derived.fields.constraints"),
      };
      const yesLabel = translate("panels.action.derived.yes");
      const noLabel = translate("panels.action.derived.no");
      return parameters.map(parameter => {
        const objectTypes = parameter.objectTypes ?? [];
        const required = parameter.required == null ? "" : (parameter.required ? yesLabel : noLabel);
        return {
          primaryKey: parameter.name,
          label: parameter.name,
          ...(parameter.description ? { subtitle: parameter.description } : {}),
          fieldLabels: paramFieldLabels,
          fields: {
            type: parameter.type,
            required,
            ...(objectTypes.length === 0 ? { objectTypes: "" } : {}),
            sample: formatJsonValue(parameter.sample),
            constraints: formatJsonValue(parameter.constraints),
          },
          ...(objectTypes.length > 0 ? { tags: { objectTypes } } : {}),
        };
      });
    },
    /** Standard record list of derived submission conditions and unrepresentable custom checks. */
    async derivedConditions(primaryKey: string): Promise<PanelRecord[]> {
      const action = await owner("action-derived-conditions", "/action/queryById", { id: primaryKey },
        z.object({ definition: actionDefinitionSchema }).passthrough());
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
      const conditionFieldLabels = {
        kind: translate("panels.action.derived.fields.conditionKind"),
        join: translate("panels.action.derived.fields.conditionJoin"),
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
            detail,
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
            detail: reason,
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
        segments,
        ...(summary.length > 0 && { summary }),
      });
    },
    /** The owner's form for a new action, which an agent drafts into after the owner adopts its trial run. */
    async createForm(params: ActionFormParams): Promise<PanelFormDescription> {
      return definitionForm("action-create-form", { kind: "draft" }, params);
    },
    /** The published object Actions for an author's type table: `readObjectActions` as this viewer. */
    objectActions: (objectType?: string) => readObjectActions(viewer, objectType),
    [`${SET_ACTION_STATUS}.describe`]() {
      return describeServerOperation(panelServerOperation(SET_ACTION_STATUS), viewer.locale);
    },
    [`${DELETE_ACTION}.describe`]() {
      return describeServerOperation(panelServerOperation(DELETE_ACTION), viewer.locale);
    },
  };
}
