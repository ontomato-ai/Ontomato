import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import {
  PlatformOntologyOwnerReaders,
  type OwnerFailureStatus,
  type OwnerReadResult,
} from "./owners";
import {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
  PLATFORM_ONTOLOGY_LAYERS,
  PLATFORM_ONTOLOGY_RELATION_KINDS,
  PLATFORM_ONTOLOGY_TYPE_MAP,
  PLATFORM_ONTOLOGY_TYPES,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  ROLE,
  SDK_COMPONENT,
  SKILL,
  TRIGGER,
  USER,
  WORKFLOW,
  relationTargets,
  type PlatformOntologyLayer,
  type PlatformOntologyRelationKindSpec,
  type PlatformOntologyTypeSpec,
} from "./schema";

const logger = createLogger("platform-ontology");

const WORKFLOW_SAVE_API = "/workflow/save";

export type PlatformOntologyStatus = "ok" | OwnerFailureStatus | "unavailable";

export interface PlatformNodeRef {
  className: string;
  primaryKey: string;
}

export interface PlatformOntologyNode {
  className: string;
  primaryKey: string;
  label: string;
  layer: PlatformOntologyLayer;
  detail?: string;
}

export interface PlatformOntologyEdge {
  id: string;
  relationKind: string;
  from: PlatformNodeRef;
  to: PlatformNodeRef;
  direction: "outgoing" | "incoming";
  derived: boolean;
}

export interface PlatformOntologyRelationStatus {
  relationKind: string;
  status: PlatformOntologyStatus;
  edgeCount: number;
  reason?: string;
}

export interface PlatformOntologySchemaResponse {
  layers: readonly PlatformOntologyLayer[];
  objectTypes: readonly PlatformOntologyTypeSpec[];
  relationKinds: readonly PlatformOntologyRelationKindSpec[];
}

export interface PlatformOntologyTypeCount {
  type: string;
  layer: PlatformOntologyLayer;
  status: PlatformOntologyStatus;
  count?: number;
  reason?: string;
}

export interface PlatformOntologyCountsResponse {
  counts: PlatformOntologyTypeCount[];
}

export interface PlatformOntologyStartResponse {
  node: PlatformNodeRef;
  label: string;
  layer: PlatformOntologyLayer;
}

export interface PlatformOntologyObjectItem {
  node: PlatformNodeRef;
  label: string;
  detail?: string;
}

export interface PlatformOntologyObjectsResponse {
  type: string;
  layer: PlatformOntologyLayer;
  status: PlatformOntologyStatus;
  reason?: string;
  items: PlatformOntologyObjectItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformOntologyNeighborsRequest {
  node: PlatformNodeRef;
  relationKinds?: readonly string[];
  layers?: readonly PlatformOntologyLayer[];
}

export interface PlatformOntologyNeighborsResponse {
  node: PlatformOntologyNode;
  neighbors: PlatformOntologyNode[];
  edges: PlatformOntologyEdge[];
  relations: PlatformOntologyRelationStatus[];
}

interface RawEdgeCandidate {
  from: PlatformNodeRef;
  to: PlatformNodeRef;
  /** Optional labels already known from the relation owner's payload. */
  fromLabel?: string;
  fromDetail?: string;
  toLabel?: string;
  toDetail?: string;
}

interface RelationEvalResult {
  status: PlatformOntologyStatus;
  reason?: string;
  edges: RawEdgeCandidate[];
}

const M3B_DEFERRED_TYPES = new Set<string>([
  SDK_COMPONENT,
  PRODUCT_PROJECTION,
  PRODUCT_PANEL,
  APPLICATION,
]);

function nodeKey(ref: PlatformNodeRef): string {
  return `${ref.className}\u0000${ref.primaryKey}`;
}

function attributeKey(className: string, attrName: string): string {
  return JSON.stringify([className, attrName]);
}

function parseAttributeKey(primaryKey: string): [string, string] | null {
  try {
    const parsed = JSON.parse(primaryKey);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Non-tuple primary key does not match any attribute.
  }
  return null;
}

function requireTypeSpec(typeId: string): PlatformOntologyTypeSpec {
  const spec = PLATFORM_ONTOLOGY_TYPE_MAP.get(typeId);
  if (!spec) throw new HttpError(400, `Unknown platform ontology type: ${typeId}`, "INVALID_PLATFORM_TYPE");
  return spec;
}

/** Lists all objects of a single declared type for counts, object picker, and label lookup. */
async function readObjectsOfType(
  readers: PlatformOntologyOwnerReaders,
  typeId: string,
): Promise<OwnerReadResult<PlatformOntologyObjectItem[]> | { ok: false; status: "unavailable"; reason: string }> {
  if (M3B_DEFERRED_TYPES.has(typeId)) {
    return { ok: false, status: "unavailable", reason: "Product layer owner adapter is scheduled for M3b" };
  }

  switch (typeId) {
    case OBJECT_TYPE: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.classes.map((cls) => ({
          node: { className: OBJECT_TYPE, primaryKey: cls.className },
          label: cls.showName || cls.classDesc || cls.className,
          detail: cls.className,
        })),
      };
    }
    case ATTRIBUTE: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      const items: PlatformOntologyObjectItem[] = [];
      for (const cls of res.data.classes) {
        for (const attr of cls.attrs) {
          items.push({
            node: { className: ATTRIBUTE, primaryKey: attributeKey(cls.className, attr.name) },
            label: attr.showName || attr.name,
            detail: cls.className,
          });
        }
      }
      return { ok: true, data: items };
    }
    case RELATIONSHIP: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.relationships.map((rel) => ({
          node: { className: RELATIONSHIP, primaryKey: rel.relationship },
          label: rel.showName || rel.desc || rel.relationship,
          detail: rel.fromclass && rel.toclass ? `${rel.fromclass} → ${rel.toclass}` : undefined,
        })),
      };
    }
    case METRIC_VIEW: {
      const res = await readers.metricViews();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((m) => ({
          node: { className: METRIC_VIEW, primaryKey: m.id },
          label: m.name,
          detail: m.status,
        })),
      };
    }
    case FUNCTION: {
      const res = await readers.functions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((fn) => ({
          node: { className: FUNCTION, primaryKey: fn.id },
          label: fn.name,
          detail: fn.operation,
        })),
      };
    }
    case ACTION: {
      const res = await readers.actions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((action) => ({
          node: { className: ACTION, primaryKey: action.id },
          label: action.name,
          detail: action.status,
        })),
      };
    }
    case WORKFLOW: {
      const res = await readers.workflows();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((wf) => ({
          node: { className: WORKFLOW, primaryKey: wf.id },
          label: wf.name,
          detail: wf.version !== undefined ? `v${wf.version}` : wf.status,
        })),
      };
    }
    case TRIGGER: {
      const res = await readers.triggers();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((tr) => ({
          node: { className: TRIGGER, primaryKey: tr.id },
          label: tr.name,
          detail: tr.effectKind ?? undefined,
        })),
      };
    }
    case SKILL: {
      const res = await readers.skills();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((skill) => ({
          node: { className: SKILL, primaryKey: skill.primaryKey },
          label: skill.title,
        })),
      };
    }
    case BUSINESS_KNOWLEDGE: {
      const res = await readers.knowledge();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((k) => ({
          node: { className: BUSINESS_KNOWLEDGE, primaryKey: k.id },
          label: k.title,
        })),
      };
    }
    case DEFINITION: {
      const res = await readers.definitions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((def) => ({
          node: { className: DEFINITION, primaryKey: def.id },
          label: def.name,
          detail: def.objectType,
        })),
      };
    }
    case USER: {
      const res = await readers.subjects();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((subj) => ({
          node: { className: USER, primaryKey: subj.id },
          label: subj.displayName || subj.loginCode || subj.id,
          detail: subj.loginCode,
        })),
      };
    }
    case ROLE: {
      const res = await readers.roles();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.roles.map((role) => ({
          node: { className: ROLE, primaryKey: role.code },
          label: role.code,
        })),
      };
    }
    case AGENT_DEFINITION: {
      const res = await readers.agentDefinitions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((agent) => ({
          node: { className: AGENT_DEFINITION, primaryKey: agent.id },
          label: agent.name,
          detail: agent.enabled ? "enabled" : "disabled",
        })),
      };
    }
    default:
      return { ok: false, status: "unavailable", reason: `No owner adapter registered for ${typeId}` };
  }
}

export function readPlatformOntologySchema(): PlatformOntologySchemaResponse {
  return {
    layers: PLATFORM_ONTOLOGY_LAYERS,
    objectTypes: PLATFORM_ONTOLOGY_TYPES,
    relationKinds: PLATFORM_ONTOLOGY_RELATION_KINDS,
  };
}

export async function readPlatformOntologyCounts(
  owner: ProductOwner,
  credentials: AssistantCredentials,
): Promise<PlatformOntologyCountsResponse> {
  const started = performance.now();
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);

  const counts = await Promise.all(
    PLATFORM_ONTOLOGY_TYPES.map(async (spec): Promise<PlatformOntologyTypeCount> => {
      const res = await readObjectsOfType(readers, spec.id);
      if (res.ok) {
        return { type: spec.id, layer: spec.layer, status: "ok", count: res.data.length };
      }
      return { type: spec.id, layer: spec.layer, status: res.status, reason: res.reason };
    }),
  );

  logger.info("platform ontology counts read", {
    durationMs: Math.round(performance.now() - started),
    ownerCalls: readers.ownerCallCount,
  });

  return { counts };
}

export async function readPlatformOntologyStart(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  callerUserName?: string,
): Promise<PlatformOntologyStartResponse> {
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const subjectsRes = await readers.subjects();
  if (subjectsRes.ok) {
    const matched = subjectsRes.data.find((subj) => subj.id === owner.userId);
    if (matched) {
      return {
        node: { className: USER, primaryKey: matched.id },
        label: matched.displayName || matched.loginCode || matched.id,
        layer: "governance",
      };
    }
  }
  // OSS uses hostOwner (`system`), and enterprise callers without subject directory access still keep their real user ID.
  return {
    node: { className: USER, primaryKey: owner.userId },
    label: callerUserName?.trim() || owner.userId,
    layer: "governance",
  };
}

export async function readPlatformOntologyObjects(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: { type: string; keyword?: string; page?: number; pageSize?: number },
): Promise<PlatformOntologyObjectsResponse> {
  const spec = requireTypeSpec(input.type);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50));
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const res = await readObjectsOfType(readers, spec.id);

  if (!res.ok) {
    return {
      type: spec.id,
      layer: spec.layer,
      status: res.status,
      reason: res.reason,
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  const keyword = input.keyword?.trim().toLowerCase() ?? "";
  const filtered = keyword
    ? res.data.filter(
        (item) =>
          item.label.toLowerCase().includes(keyword) ||
          item.node.primaryKey.toLowerCase().includes(keyword) ||
          (item.detail?.toLowerCase().includes(keyword) ?? false),
      )
    : res.data;

  const sorted = [...filtered].sort((a, b) => a.label.localeCompare(b.label) || a.node.primaryKey.localeCompare(b.node.primaryKey));
  const offset = (page - 1) * pageSize;

  return {
    type: spec.id,
    layer: spec.layer,
    status: "ok",
    items: sorted.slice(offset, offset + pageSize),
    total: sorted.length,
    page,
    pageSize,
  };
}

/** Evaluates one declared relation kind for the requested center node (outgoing or incoming). */
async function evaluateRelationKind(
  readers: PlatformOntologyOwnerReaders,
  spec: PlatformOntologyRelationKindSpec,
  node: PlatformNodeRef,
): Promise<RelationEvalResult> {
  switch (spec.id) {
    case "object-type.has-attribute": {
      const res = await readers.ontologyMeta();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      if (node.className === OBJECT_TYPE) {
        const cls = res.data.classes.find((c) => c.className === node.primaryKey);
        if (cls) {
          for (const attr of cls.attrs) {
            edges.push({
              from: node,
              to: { className: ATTRIBUTE, primaryKey: attributeKey(cls.className, attr.name) },
              fromLabel: cls.showName || cls.classDesc || cls.className,
              toLabel: attr.showName || attr.name,
              toDetail: cls.className,
            });
          }
        }
      } else if (node.className === ATTRIBUTE) {
        const parsed = parseAttributeKey(node.primaryKey);
        if (parsed) {
          const [className, attrName] = parsed;
          const cls = res.data.classes.find((c) => c.className === className);
          const attr = cls?.attrs.find((a) => a.name === attrName);
          if (cls && attr) {
            edges.push({
              from: { className: OBJECT_TYPE, primaryKey: cls.className },
              to: node,
              fromLabel: cls.showName || cls.classDesc || cls.className,
              toLabel: attr.showName || attr.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "relationship.from-object-type":
    case "relationship.to-object-type": {
      const res = await readers.ontologyMeta();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const field = spec.id === "relationship.from-object-type" ? "fromclass" : "toclass";
      const edges: RawEdgeCandidate[] = [];
      for (const rel of res.data.relationships) {
        const targetClass = rel[field];
        if (!targetClass) continue;
        if (
          (node.className === RELATIONSHIP && rel.relationship === node.primaryKey) ||
          (node.className === OBJECT_TYPE && targetClass === node.primaryKey)
        ) {
          edges.push({
            from: { className: RELATIONSHIP, primaryKey: rel.relationship },
            to: { className: OBJECT_TYPE, primaryKey: targetClass },
            fromLabel: rel.showName || rel.desc || rel.relationship,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "metric-view.uses-function": {
      const res = await readers.metricViews();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const m of res.data) {
        if (!m.functionId) continue;
        if (
          (node.className === METRIC_VIEW && m.id === node.primaryKey) ||
          (node.className === FUNCTION && m.functionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: METRIC_VIEW, primaryKey: m.id },
            to: { className: FUNCTION, primaryKey: m.functionId },
            fromLabel: m.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "action.uses-function": {
      const res = await readers.actions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const action of res.data) {
        if (!action.functionId) continue;
        if (
          (node.className === ACTION && action.id === node.primaryKey) ||
          (node.className === FUNCTION && action.functionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ACTION, primaryKey: action.id },
            to: { className: FUNCTION, primaryKey: action.functionId },
            fromLabel: action.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "function.reads-object-type": {
      const res = await readers.functions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const fn of res.data) {
        for (const className of fn.classNames) {
          if (
            (node.className === FUNCTION && fn.id === node.primaryKey) ||
            (node.className === OBJECT_TYPE && className === node.primaryKey)
          ) {
            edges.push({
              from: { className: FUNCTION, primaryKey: fn.id },
              to: { className: OBJECT_TYPE, primaryKey: className },
              fromLabel: fn.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "action.targets-object-type": {
      const res = await readers.actions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const action of res.data) {
        if (!action.targetClassName) continue;
        if (
          (node.className === ACTION && action.id === node.primaryKey) ||
          (node.className === OBJECT_TYPE && action.targetClassName === node.primaryKey)
        ) {
          edges.push({
            from: { className: ACTION, primaryKey: action.id },
            to: { className: OBJECT_TYPE, primaryKey: action.targetClassName },
            fromLabel: action.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "definition.based-on-object-type": {
      const res = await readers.definitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const def of res.data) {
        if (!def.objectType || def.objectType.startsWith("platform:")) continue;
        if (
          (node.className === DEFINITION && def.id === node.primaryKey) ||
          (node.className === OBJECT_TYPE && def.objectType === node.primaryKey)
        ) {
          edges.push({
            from: { className: DEFINITION, primaryKey: def.id },
            to: { className: OBJECT_TYPE, primaryKey: def.objectType },
            fromLabel: def.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "workflow.step-references-action": {
      const res = await readers.workflows();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const wf of res.data) {
        for (const step of wf.steps) {
          if (!step.actionId) continue;
          if (
            (node.className === WORKFLOW && wf.id === node.primaryKey) ||
            (node.className === ACTION && step.actionId === node.primaryKey)
          ) {
            edges.push({
              from: { className: WORKFLOW, primaryKey: wf.id },
              to: { className: ACTION, primaryKey: step.actionId },
              fromLabel: wf.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "trigger.targets-workflow": {
      const res = await readers.triggers();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const tr of res.data) {
        if (!tr.workflowId) continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === WORKFLOW && tr.workflowId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: WORKFLOW, primaryKey: tr.workflowId },
            fromLabel: tr.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "trigger.targets-action": {
      const res = await readers.triggers();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const tr of res.data) {
        if (!tr.actionId) continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === ACTION && tr.actionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: ACTION, primaryKey: tr.actionId },
            fromLabel: tr.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.holds-role": {
      const subjectsRes = await readers.subjects();
      if (!subjectsRes.ok) return { status: subjectsRes.status, reason: subjectsRes.reason, edges: [] };
      if (node.className === USER) {
        const subject = subjectsRes.data.find((s) => s.id === node.primaryKey);
        if (!subject || subject.roleIds.length === 0) return { status: "ok", edges: [] };
        const rolesRes = await readers.roles();
        if (!rolesRes.ok) return { status: rolesRes.status, reason: rolesRes.reason, edges: [] };
        const edges: RawEdgeCandidate[] = [];
        for (const roleId of subject.roleIds) {
          const roleCode = rolesRes.data.codeById.get(roleId);
          if (roleCode) {
            edges.push({
              from: { className: USER, primaryKey: subject.id },
              to: { className: ROLE, primaryKey: roleCode },
              fromLabel: subject.displayName || subject.loginCode || subject.id,
              toLabel: roleCode,
            });
          }
        }
        return { status: "ok", edges };
      }
      if (node.className === ROLE) {
        const rolesRes = await readers.roles();
        if (!rolesRes.ok) return { status: rolesRes.status, reason: rolesRes.reason, edges: [] };
        const role = rolesRes.data.byCode.get(node.primaryKey);
        if (!role?.id) return { status: "ok", edges: [] };
        const edges: RawEdgeCandidate[] = [];
        for (const subject of subjectsRes.data) {
          if (subject.roleIds.includes(role.id)) {
            edges.push({
              from: { className: USER, primaryKey: subject.id },
              to: { className: ROLE, primaryKey: role.code },
              fromLabel: subject.displayName || subject.loginCode || subject.id,
              toLabel: role.code,
            });
          }
        }
        return { status: "ok", edges };
      }
      return { status: "ok", edges: [] };
    }

    case "role.can-execute-action": {
      const res = await readers.grants();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const grant of res.data) {
        if (!grant.inForce || grant.capabilityKind !== "ACTION" || !grant.capabilityId || !grant.roleCode) continue;
        if (
          (node.className === ROLE && grant.roleCode === node.primaryKey) ||
          (node.className === ACTION && grant.capabilityId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ROLE, primaryKey: grant.roleCode },
            to: { className: ACTION, primaryKey: grant.capabilityId },
            fromLabel: grant.roleCode,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "role.can-author-workflow": {
      const accessRes = await readers.platformAccess();
      if (!accessRes.ok) return { status: accessRes.status, reason: accessRes.reason, edges: [] };
      const authoringRoles = accessRes.data.filter(
        (a) => a.roleCode && (a.managementRole || a.apiPermissions.includes(WORKFLOW_SAVE_API)),
      );
      if (node.className === ROLE) {
        const canAuthor = authoringRoles.some((a) => a.roleCode === node.primaryKey);
        if (!canAuthor) return { status: "ok", edges: [] };
        const wfRes = await readers.workflows();
        if (!wfRes.ok) return { status: wfRes.status, reason: wfRes.reason, edges: [] };
        return {
          status: "ok",
          edges: wfRes.data.map((wf) => ({
            from: { className: ROLE, primaryKey: node.primaryKey },
            to: { className: WORKFLOW, primaryKey: wf.id },
            fromLabel: node.primaryKey,
            toLabel: wf.name,
          })),
        };
      }
      if (node.className === WORKFLOW) {
        const wfRes = await readers.workflows();
        if (!wfRes.ok) return { status: wfRes.status, reason: wfRes.reason, edges: [] };
        const wf = wfRes.data.find((item) => item.id === node.primaryKey);
        if (!wf) return { status: "ok", edges: [] };
        return {
          status: "ok",
          edges: authoringRoles.map((a) => ({
            from: { className: ROLE, primaryKey: a.roleCode! },
            to: { className: WORKFLOW, primaryKey: wf.id },
            fromLabel: a.roleCode!,
            toLabel: wf.name,
          })),
        };
      }
      return { status: "ok", edges: [] };
    }

    case "role.owns-workflow-step": {
      const res = await readers.workflows();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const wf of res.data) {
        const roleCodes = new Set(wf.steps.map((s) => s.roleCode).filter((c): c is string => Boolean(c)));
        for (const roleCode of roleCodes) {
          if (
            (node.className === ROLE && roleCode === node.primaryKey) ||
            (node.className === WORKFLOW && wf.id === node.primaryKey)
          ) {
            edges.push({
              from: { className: ROLE, primaryKey: roleCode },
              to: { className: WORKFLOW, primaryKey: wf.id },
              fromLabel: roleCode,
              toLabel: wf.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "user.created-action":
    case "user.published-action": {
      const res = await readers.actions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const field = spec.id === "user.created-action" ? "createdBy" : "reviewedBy";
      const edges: RawEdgeCandidate[] = [];
      for (const action of res.data) {
        const rawUser = action[field];
        if (!rawUser) continue;
        const userId = await readers.normalizeSubjectId(rawUser);
        if (
          (node.className === USER && userId === node.primaryKey) ||
          (node.className === ACTION && action.id === node.primaryKey)
        ) {
          edges.push({
            from: { className: USER, primaryKey: userId },
            to: { className: ACTION, primaryKey: action.id },
            toLabel: action.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.created-workflow":
    case "user.published-workflow": {
      const res = await readers.workflows();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const field = spec.id === "user.created-workflow" ? "createdBy" : "reviewedBy";
      const edges: RawEdgeCandidate[] = [];
      for (const wf of res.data) {
        const rawUser = wf[field];
        if (!rawUser) continue;
        const userId = await readers.normalizeSubjectId(rawUser);
        if (
          (node.className === USER && userId === node.primaryKey) ||
          (node.className === WORKFLOW && wf.id === node.primaryKey)
        ) {
          edges.push({
            from: { className: USER, primaryKey: userId },
            to: { className: WORKFLOW, primaryKey: wf.id },
            toLabel: wf.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.created-metric-view":
    case "user.published-metric-view": {
      const res = await readers.metricViews();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const field = spec.id === "user.created-metric-view" ? "createdBy" : "reviewedBy";
      const edges: RawEdgeCandidate[] = [];
      for (const m of res.data) {
        const rawUser = m[field];
        if (!rawUser) continue;
        const userId = await readers.normalizeSubjectId(rawUser);
        if (
          (node.className === USER && userId === node.primaryKey) ||
          (node.className === METRIC_VIEW && m.id === node.primaryKey)
        ) {
          edges.push({
            from: { className: USER, primaryKey: userId },
            to: { className: METRIC_VIEW, primaryKey: m.id },
            toLabel: m.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "agent.uses-skill": {
      const res = await readers.agentDefinitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const agent of res.data) {
        for (const skillRef of agent.skills) {
          const skillKey = runtimeSkillKey(skillRef);
          if (
            (node.className === AGENT_DEFINITION && agent.id === node.primaryKey) ||
            (node.className === SKILL && skillKey === node.primaryKey)
          ) {
            edges.push({
              from: { className: AGENT_DEFINITION, primaryKey: agent.id },
              to: { className: SKILL, primaryKey: skillKey },
              fromLabel: agent.name,
              toLabel: skillRef.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "agent.executes-as-user": {
      const res = await readers.agentDefinitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const agent of res.data) {
        if (!agent.executionUserId) continue;
        const userId = await readers.normalizeSubjectId(agent.executionUserId);
        if (
          (node.className === AGENT_DEFINITION && agent.id === node.primaryKey) ||
          (node.className === USER && userId === node.primaryKey)
        ) {
          edges.push({
            from: { className: AGENT_DEFINITION, primaryKey: agent.id },
            to: { className: USER, primaryKey: userId },
            fromLabel: agent.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "projection.uses-component":
    case "projection.binds-target":
    case "panel.contains-projection":
    case "application.uses-panel":
      return {
        status: "unavailable",
        reason: "Product layer relation adapter is scheduled for M3b",
        edges: [],
      };

    default:
      return { status: "unavailable", reason: `Unhandled relation kind: ${spec.id}`, edges: [] };
  }
}

export async function readPlatformOntologyNeighbors(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: PlatformOntologyNeighborsRequest,
  callerUserName?: string,
): Promise<PlatformOntologyNeighborsResponse> {
  const started = performance.now();
  const centerSpec = requireTypeSpec(input.node.className);
  const centerKey = nodeKey(input.node);

  const kindFilter = input.relationKinds?.length ? new Set(input.relationKinds) : null;
  const layerFilter = input.layers?.length ? new Set(input.layers) : null;

  const applicableRelations = PLATFORM_ONTOLOGY_RELATION_KINDS.filter((rel) => {
    if (kindFilter && !kindFilter.has(rel.id)) return false;
    const targets = relationTargets(rel);
    const isOutgoing = rel.from === input.node.className;
    const isIncoming = targets.includes(input.node.className);
    if (!isOutgoing && !isIncoming) return false;
    if (layerFilter) {
      const oppositeTypes: string[] = [];
      if (isOutgoing) oppositeTypes.push(...targets);
      if (isIncoming) oppositeTypes.push(rel.from);
      const anyLayerMatches = oppositeTypes.some((t) => {
        const tSpec = PLATFORM_ONTOLOGY_TYPE_MAP.get(t);
        return tSpec ? layerFilter.has(tSpec.layer) : false;
      });
      if (!anyLayerMatches) return false;
    }
    return true;
  });

  const readers = new PlatformOntologyOwnerReaders(owner, credentials);

  const evaluations = await Promise.all(
    applicableRelations.map(async (rel) => ({
      spec: rel,
      result: await evaluateRelationKind(readers, rel, input.node),
    })),
  );

  const seenEdges = new Set<string>();
  const edges: PlatformOntologyEdge[] = [];
  const relations: PlatformOntologyRelationStatus[] = [];
  const neighborRefs = new Map<string, PlatformNodeRef>();
  const hintLabels = new Map<string, { label: string; detail?: string }>();

  for (const { spec, result } of evaluations) {
    let addedCount = 0;
    for (const candidate of result.edges) {
      const fromKey = nodeKey(candidate.from);
      const toKey = nodeKey(candidate.to);
      const direction: "outgoing" | "incoming" = fromKey === centerKey ? "outgoing" : "incoming";
      const opposite = direction === "outgoing" ? candidate.to : candidate.from;
      const oppositeSpec = PLATFORM_ONTOLOGY_TYPE_MAP.get(opposite.className);
      if (!oppositeSpec) continue;
      if (layerFilter && !layerFilter.has(oppositeSpec.layer)) continue;

      const dedupKey = `${spec.id}|${fromKey}|${toKey}`;
      if (seenEdges.has(dedupKey)) continue;
      seenEdges.add(dedupKey);
      addedCount++;

      edges.push({
        id: `${spec.id}:${candidate.from.className}:${candidate.from.primaryKey}->${candidate.to.className}:${candidate.to.primaryKey}`,
        relationKind: spec.id,
        from: candidate.from,
        to: candidate.to,
        direction,
        derived: spec.derived,
      });

      if (candidate.fromLabel) hintLabels.set(fromKey, { label: candidate.fromLabel, detail: candidate.fromDetail });
      if (candidate.toLabel) hintLabels.set(toKey, { label: candidate.toLabel, detail: candidate.toDetail });

      const oppKey = nodeKey(opposite);
      if (oppKey !== centerKey && !neighborRefs.has(oppKey)) {
        neighborRefs.set(oppKey, opposite);
      }
    }

    relations.push({
      relationKind: spec.id,
      status: result.status,
      edgeCount: addedCount,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  // Resolve canonical labels from each referenced node's owner (reusing per-request cache).
  const typesToResolve = new Set<string>([input.node.className]);
  for (const ref of neighborRefs.values()) typesToResolve.add(ref.className);

  const labelMaps = new Map<string, Map<string, { label: string; detail?: string }>>();
  await Promise.all(
    [...typesToResolve].map(async (typeId) => {
      const res = await readObjectsOfType(readers, typeId);
      if (!res.ok) return;
      const map = new Map<string, { label: string; detail?: string }>();
      for (const item of res.data) {
        map.set(item.node.primaryKey, { label: item.label, detail: item.detail });
      }
      labelMaps.set(typeId, map);
    }),
  );

  const toNode = (ref: PlatformNodeRef): PlatformOntologyNode => {
    const typeSpec = PLATFORM_ONTOLOGY_TYPE_MAP.get(ref.className)!;
    const ownerEntry = labelMaps.get(ref.className)?.get(ref.primaryKey);
    const hintEntry = hintLabels.get(nodeKey(ref));
    const fallbackLabel =
      ref.className === USER && ref.primaryKey === owner.userId && callerUserName?.trim()
        ? callerUserName.trim()
        : ref.primaryKey;
    return {
      className: ref.className,
      primaryKey: ref.primaryKey,
      label: ownerEntry?.label ?? hintEntry?.label ?? fallbackLabel,
      layer: typeSpec.layer,
      ...(ownerEntry?.detail ?? hintEntry?.detail ? { detail: ownerEntry?.detail ?? hintEntry?.detail } : {}),
    };
  };

  const centerNode: PlatformOntologyNode = {
    ...toNode(input.node),
    layer: centerSpec.layer,
  };
  const neighbors = [...neighborRefs.values()].map(toNode);

  logger.info("platform ontology neighbors read", {
    durationMs: Math.round(performance.now() - started),
    nodeType: input.node.className,
    relationCount: applicableRelations.length,
    ownerCalls: readers.ownerCallCount,
    neighborCount: neighbors.length,
    edgeCount: edges.length,
  });

  return {
    node: centerNode,
    neighbors,
    edges,
    relations,
  };
}
