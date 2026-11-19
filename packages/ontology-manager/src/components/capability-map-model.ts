import type { MessageKey } from "../i18n";
import type {
  CapabilityGrantRecord,
  PlatformAccessRecord,
  SmartAsset,
  SubjectRecord,
  TriggerRecord,
  WorkflowRecord,
} from "../api";
import type { CapabilityNode } from "./capability-map-rendering";

/**
 * What the capability map draws, computed from the domain's rows.
 *
 * <p>Kept out of the component because it is a statement about the model, not about the canvas: which objects exist, and
 * which relation each pair of them has. A drawing can be wrong in ways a graph cannot — a node off screen, an edge
 * covered by a label — so the claim "one member who both created and published an action yields two relations" has to
 * be checkable without mounting a renderer.</p>
 */

export interface CapabilityMapInputs {
  subjects: SubjectRecord[];
  workflows: WorkflowRecord[];
  actions: SmartAsset[];
  metrics: SmartAsset[];
  functions: SmartAsset[];
  skills: Array<{ id: string; title: string }>;
  triggers: TriggerRecord[];
  grants: CapabilityGrantRecord[];
  platformAccess: PlatformAccessRecord[];
}

export interface CapabilityMapEdge {
  from: string;
  to: string;
  label: string;
  derived?: boolean;
}

export interface CapabilityRole {
  id?: string;
  code: string;
}

export interface CapabilityMapModel {
  roles: CapabilityRole[];
  nodes: CapabilityNode[];
  edges: CapabilityMapEdge[];
}

/** The platform operation that authorizes authoring a process; a role holding it may create workflows. */
const WORKFLOW_SAVE = "/workflow/save";

/**
 * Roles are collected from three places because each records a different fact: the directory says who holds a role, the
 * grants say what it may run, and the platform access says what it may author. A role known only by code — a step
 * written before the role existed — is still listed, because the process does name it.
 */
export function capabilityRoles(inputs: CapabilityMapInputs): CapabilityRole[] {
  const byCode = new Map<string, CapabilityRole>();
  const add = (id?: string | null, code?: string | null) => {
    if (!code) return;
    const existing = byCode.get(code);
    byCode.set(code, { id: id ?? existing?.id, code });
  };
  for (const access of inputs.platformAccess) add(access.roleId, access.roleCode);
  for (const grant of inputs.grants) add(grant.roleId, grant.roleCode);
  for (const workflow of inputs.workflows) {
    for (const step of workflow.steps ?? []) add(null, step.roleCode);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

export function buildCapabilityMap(
  inputs: CapabilityMapInputs,
  text: (key: MessageKey) => string,
): CapabilityMapModel {
  const roles = capabilityRoles(inputs);
  const nodes: CapabilityNode[] = [];

  for (const subject of inputs.subjects) {
    nodes.push({
      id: `subject:${subject.id}`,
      kind: "subject",
      layer: "governance",
      label: subject.displayName || subject.loginCode || subject.id,
      detail: subject.loginCode ?? "",
    });
  }
  for (const role of roles) {
    nodes.push({ id: `role:${role.code}`, kind: "role", layer: "governance", label: role.code, detail: "" });
  }
  for (const action of inputs.actions) {
    if (!action.id) continue;
    nodes.push({ id: `action:${action.id}`, kind: "action", layer: "capability", label: action.name, detail: action.status ?? "" });
  }
  for (const workflow of inputs.workflows) {
    if (!workflow.id) continue;
    nodes.push({
      id: `workflow:${workflow.id}`,
      kind: "workflow",
      layer: "capability",
      label: workflow.name,
      detail: `v${workflow.version ?? 0}`,
    });
  }
  for (const trigger of inputs.triggers) {
    if (!trigger.id) continue;
    // The effect is shown on the node, not drawn as an edge: a trigger names one workflow or action by id, and an arrow
    // to every process would assert links the row does not carry.
    const effectName = trigger.effectKind === "workflow"
      ? trigger.effect?.workflowId
      : trigger.effect?.actionId;
    nodes.push({
      id: `trigger:${trigger.id}`,
      kind: "trigger",
      layer: "capability",
      label: trigger.name,
      detail: `${trigger.effectKind ?? ""}${effectName ? ` · ${effectName}` : ""}`.trim() || (trigger.enabled ? "" : text("triggerOff")),
    });
  }
  for (const metric of inputs.metrics) {
    if (!metric.id) continue;
    nodes.push({ id: `metric:${metric.id}`, kind: "metric", layer: "capability", label: metric.name, detail: metric.status ?? "" });
  }
  for (const fn of inputs.functions) {
    if (!fn.id) continue;
    nodes.push({ id: `function:${fn.id}`, kind: "function", layer: "capability", label: fn.name, detail: fn.status ?? "" });
  }
  for (const skill of inputs.skills) {
    nodes.push({ id: `skill:${skill.id}`, kind: "skill", layer: "capability", label: skill.title || skill.id, detail: "" });
  }

  const edges: CapabilityMapEdge[] = [];
  const drawn = new Set(nodes.map((node) => node.id));
  const roleByCode = new Map(roles.map((role) => [role.code, role]));
  const push = (from: string, to: string, label: string, derived = false) => {
    if (!drawn.has(from) || !drawn.has(to)) return;
    edges.push({ from, to, label, derived });
  };

  // subject -> role: the stored membership, with organization and position grants already folded in.
  for (const subject of inputs.subjects) {
    for (const roleId of subject.roleIds ?? []) {
      const role = roles.find((candidate) => candidate.id === roleId);
      if (role) push(`subject:${subject.id}`, `role:${role.code}`, text("mapEdgeHolds"));
    }
  }

  // role -> action: authority currently in force.
  for (const grant of inputs.grants) {
    if (!grant.inForce || grant.capabilityKind !== "ACTION" || !grant.capabilityId) continue;
    const role = grant.roleCode ? roleByCode.get(grant.roleCode) : undefined;
    if (role) push(`role:${role.code}`, `action:${grant.capabilityId}`, text("mapEdgeRuns"));
  }

  // role -> workflow: authority to author one, read from the chain the interceptor actually enforces. A management role
  // holds every enabled operation by rule, so it passes on the flag rather than on a listed path.
  for (const access of inputs.platformAccess) {
    if (!access.roleCode) continue;
    const mayAuthor =
      access.managementRole === true || (access.apiPermissions ?? []).includes(WORKFLOW_SAVE);
    if (!mayAuthor) continue;
    for (const workflow of inputs.workflows) {
      if (workflow.id) push(`role:${access.roleCode}`, `workflow:${workflow.id}`, text("mapEdgeAuthors"));
    }
  }

  // workflow -> action: the steps name it.
  for (const workflow of inputs.workflows) {
    if (!workflow.id) continue;
    for (const step of workflow.steps ?? []) {
      if (step.actionId) push(`workflow:${workflow.id}`, `action:${step.actionId}`, text("mapEdgeNames"));
    }
  }

  // role -> workflow (derived): a step names the role, so the process needs it to run. Nothing stores this edge.
  for (const workflow of inputs.workflows) {
    if (!workflow.id) continue;
    const codes = new Set((workflow.steps ?? []).map((step) => step.roleCode).filter(Boolean));
    for (const code of codes) {
      if (code) push(`role:${code}`, `workflow:${workflow.id}`, text("mapEdgeOwnsStep"), true);
    }
  }

  // subject -> what they authored or published. Publication is the review moment, so both edges read stored fields and
  // differ only in which one they name. One member can be both, which is why both are drawn.
  const provenance = (
    items: Array<{ id?: string; createdBy?: string | null; reviewedBy?: string | null }>,
    key: (id: string) => string,
    field: "createdBy" | "reviewedBy",
    label: string,
    derived: boolean,
  ) => {
    for (const item of items) {
      const subject = item[field];
      if (!item.id || !subject) continue;
      push(`subject:${subject}`, key(item.id), label, derived);
    }
  };
  provenance(inputs.workflows, (id) => `workflow:${id}`, "createdBy", text("mapEdgeCreated"), false);
  provenance(inputs.actions, (id) => `action:${id}`, "createdBy", text("mapEdgeCreated"), false);
  provenance(inputs.metrics, (id) => `metric:${id}`, "createdBy", text("mapEdgeCreated"), false);
  provenance(inputs.workflows, (id) => `workflow:${id}`, "reviewedBy", text("mapEdgeReviewed"), true);
  provenance(inputs.actions, (id) => `action:${id}`, "reviewedBy", text("mapEdgeReviewed"), true);
  provenance(inputs.metrics, (id) => `metric:${id}`, "reviewedBy", text("mapEdgeReviewed"), true);

  // One row per pairing and per kind: a process naming the same action twice is still one line, but the same member
  // creating and publishing the same action is two, because they are two different facts.
  const seen = new Set<string>();
  const unique = edges.filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.derived ? "d" : "s"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { roles, nodes, edges: unique };
}
