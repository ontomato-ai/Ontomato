import { z } from "zod";
import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { panelReadParameterSchemas, type PanelFormValues, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { readRefusal } from "../action/object-actions";
import type { ProductOwner } from "../product-governance/grants";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import { operationHost } from "../product-panels/operation-host";
import { describeServerOperation, panelServerOperation } from "../product-panels/server-operations";
import {
  canActivateWorkflow, canDeactivateWorkflow, requireWorkflow, scopeKinds, stepInvocation,
  workflowForm, workflowFormValues, workflowSchema, workflowText, type Workflow, type WorkflowStep,
} from "./definition";

const subjectSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  loginCode: z.string().nullish(),
});
const actionSchema = z.object({
  id: z.string().nullish(),
  name: z.string(),
  status: z.string().nullish(),
});
const grantSchema = z.object({
  workflowId: z.string().nullish(),
  roleCode: z.string().nullish(),
  roleId: z.string().nullish(),
  capabilityId: z.string().nullish(),
  stepNo: z.number().nullish(),
  scope: z.object({ kind: z.enum(scopeKinds), field: z.string().nullish() }),
  inForce: z.boolean(),
  activatedByWorkflowVersion: z.number().nullish(),
});
const querySchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  cursor: panelReadParameterSchemas.cursor.optional(),
  size: panelReadParameterSchemas.size.optional(),
}).strict();

type Subject = z.infer<typeof subjectSchema>;
type Grant = z.infer<typeof grantSchema>;

const subjectLabel = (subject: Subject) => subject.displayName || subject.loginCode || subject.id;
const grantRole = (grant: Grant) => grant.roleCode || grant.roleId || "-";
const caseScopedSteps = (workflow: Workflow) => (workflow.steps ?? []).filter(step => step.caseScoped === true);

export function createWorkflowReadAdapter(reader: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const t = workflowText(viewer.locale);
  const labels = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, t(`fields.${name}`)]));

  async function read<T>(path: string, body: object, schema: z.ZodType<T>): Promise<T> {
    const response = await backendPost(path, base + path, body, options);
    const envelope = ownerEnvelopeSchema.parse(JSON.parse(response.text));
    if (!envelope.success) throw readRefusal(envelope, "WORKFLOW_READ_FAILED", t("readFailed"));
    return schema.parse(envelope.data);
  }

  const workflows = () => read("/workflow/query", {}, z.array(workflowSchema));
  async function workflow(id: string) {
    return requireWorkflow(await read("/workflow/query", { id }, workflowSchema.nullish()), viewer.locale);
  }
  const subjects = () => read("/workflow/subjects", {}, z.array(subjectSchema)).catch(() => []);
  const actions = () => read("/action/queryList", {}, z.array(actionSchema)).catch(() => []);
  const grants = () => read("/workflow/grants", {}, z.array(grantSchema)).catch((error: unknown) => {
    throw new HttpError(error instanceof HttpError ? error.status : 502, t("grantsUnavailable"), "WORKFLOW_GRANTS_UNAVAILABLE", error);
  });

  async function recordContext() {
    const [directory, grantRows, catalogue] = await Promise.all([subjects(), grants().catch(() => null), actions()]);
    return {
      directory,
      subjectNames: new Map(directory.map(subject => [subject.id, subjectLabel(subject)])),
      grants: grantRows,
      catalogue,
    };
  }

  function policyPrincipal(step: WorkflowStep, directory: Subject[]) {
    const configured = step.actorPolicy?.executionPrincipalId?.trim();
    if (!configured) return t("systemPrincipal");
    const subject = directory.find(candidate => candidate.id === configured || candidate.loginCode === configured);
    return subject ? `${subjectLabel(subject)} (${subject.loginCode || subject.id})` : configured;
  }

  function stepSummary(steps: WorkflowStep[], directory: Subject[], catalogue: z.infer<typeof actionSchema>[]) {
    if (!steps.length) return t("noSteps");
    return steps.map(step => {
      const actor = step.actorPolicy?.mode ?? "none";
      const invocation = t(`invocation.${stepInvocation(step)}`);
      const policy = actor === "none" ? "" : ` · ${t(`policy.${actor}`)} · ${policyPrincipal(step, directory)}`;
      const scoped = step.caseScoped ? ` · ${t("fields.caseScoped")}` : "";
      return `${step.name || actionName(catalogue, step.actionId)} [${invocation}${policy}${scoped}]`;
    }).join(" → ");
  }

  function recordRow(row: Workflow, context: Awaited<ReturnType<typeof recordContext>>): PanelRecord {
    const active = canDeactivateWorkflow(row);
    const inactive = row.status === "INACTIVE";
    const statusCode = active ? "ACTIVE" : inactive ? "INACTIVE" : "DRAFT";
    const statusLabel = t(`status.${statusCode}`);
    const statusTone = active ? "success" : inactive ? "info" : "warning";
    const hasDraft = Boolean(row.hasDraft);
    const draftLabel = hasDraft && statusCode !== "DRAFT" ? t("status.DRAFT") : undefined;
    const statusBadges = draftLabel ? [statusLabel, draftLabel] : [statusLabel];
    const inForce = context.grants?.filter(grant => grant.workflowId === row.id && grant.inForce) ?? [];
    const activeGrantRev = inForce[0]?.activatedByWorkflowVersion ?? (inForce.length > 0 ? row.version : null);
    const steps = caseScopedSteps(row).length;
    const noGrants = context.grants !== null && inForce.length === 0 && steps === 0;
    const grantSummary = [
      inForce.length > 0 && t("grantsSummary", { capabilities: inForce.length, roles: new Set(inForce.map(grantRole)).size }),
      steps > 0 && t("caseScopedSummary", { steps }),
    ].filter(Boolean).join(" · ");
    const fields = {
      status: statusLabel,
      statusBadges,
      statusCode,
      hasDraft,
      ...(draftLabel && { hasDraftLabel: draftLabel }),
      version: `v${row.version ?? 0}`,
      ...(activeGrantRev != null && { activeGrantVersion: `v${activeGrantRev}` }),
      stepsSummary: stepSummary(row.steps ?? [], context.directory, context.catalogue),
      grantsSummary: context.grants === null ? t("grantsUnavailable") : noGrants ? t("noGrants") : grantSummary,
      createdBy: context.subjectNames.get(row.createdBy ?? "") ?? t("unspecified"),
      reviewedBy: context.subjectNames.get(row.reviewedBy ?? "") ?? t("unspecified"),
      canActivate: canActivateWorkflow(row),
      canDeactivate: active,
    };
    return {
      primaryKey: row.id,
      label: row.name,
      ...(row.description && { subtitle: row.description }),
      fields,
      fieldLabels: labels(Object.keys(fields)),
      tones: { status: statusTone, statusBadges: statusTone, ...(noGrants && { grantsSummary: "warning" }) },
    };
  }

  async function list() {
    const [rows, context] = await Promise.all([workflows(), recordContext()]);
    return rows.map(row => recordRow(row, context));
  }

  async function formOptions() {
    const [directory, catalogue] = await Promise.all([subjects(), actions()]);
    return {
      subjects: directory.map(subject => ({
        value: subject.id,
        label: `${subjectLabel(subject)} (${subject.loginCode || subject.id})`,
      })),
      actions: catalogue.flatMap(action => action.id && (!action.status || action.status === "PUBLISHED")
        ? [{ value: action.id, label: action.name }] : []),
    };
  }

  const actionName = (catalogue: z.infer<typeof actionSchema>[], id?: string | null) =>
    catalogue.find(action => action.id === (id ?? ""))?.name || id || "-";

  async function grantRows(id: string, group: "inForce" | "superseded" | "direct"): Promise<PanelRecord[]> {
    const [all, catalogue] = await Promise.all([grants(), actions()]);
    const rows = all.filter(grant => group === "direct" ? !grant.workflowId
      : grant.workflowId === id && grant.inForce === (group === "inForce"));
    const grouped = new Map<string, Set<string>>();
    for (const grant of rows) {
      const role = grantRole(grant);
      const capabilities = grouped.get(role) ?? new Set<string>();
      capabilities.add([
        actionName(catalogue, grant.capabilityId), grant.stepNo, t(`scope.${grant.scope.kind}`), grant.scope.field,
      ].filter(Boolean).join(" · "));
      grouped.set(role, capabilities);
    }
    const fieldLabels = labels(["roleCode", "capabilities"]);
    return [...grouped].map(([roleCode, names]) => ({
      primaryKey: roleCode,
      label: roleCode,
      fieldLabels,
      fields: { roleCode, capabilities: [...names] },
      tags: { capabilities: [...names] },
      ...(group !== "inForce" && { tones: { capabilities: group === "direct" ? "success" : "info" } }),
    }));
  }

  const describe = (operation: string) =>
    describeServerOperation(panelServerOperation(operation), operationHost({ owner: reader, credentials: viewer }));

  return {
    list,
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const { search, cursor, size } = querySchema.parse(params);
      if (cursor !== undefined && !/^\d+$/.test(cursor))
        throw new HttpError(400, "The cursor does not name a position in the list", "INVALID_CURSOR");
      const offset = Number(cursor ?? 0);
      const term = search?.trim().toLowerCase();
      const rows = await list();
      const kept = term ? rows.filter(row => [
        row.label, row.subtitle, row.fields.stepsSummary, row.fields.createdBy, row.fields.reviewedBy,
        row.fields.status, row.fields.hasDraftLabel,
      ].join(" ").toLowerCase().includes(term)) : rows;
      return {
        rows: kept.slice(offset, size === undefined ? undefined : offset + size),
        ...(size !== undefined && offset + size < kept.length && { nextCursor: String(offset + size) }),
        total: kept.length,
      };
    },
    async count() {
      return { rows: [], total: (await workflows()).length };
    },
    async record(id: string) {
      const [row, context] = await Promise.all([workflow(id), recordContext()]);
      return recordRow(row, context);
    },
    async form(id: string) {
      const [row, options] = await Promise.all([workflow(id), formOptions()]);
      return workflowForm(t, options.actions, options.subjects, true, workflowFormValues(row));
    },
    async createForm({ values }: { values?: PanelFormValues; changedField?: string | null }) {
      const options = await formOptions();
      return workflowForm(t, options.actions, options.subjects, false, values);
    },
    async grantCaseScopedSteps(id: string): Promise<PanelRecord[]> {
      const [row, catalogue] = await Promise.all([workflow(id), actions(), grants()]);
      const fieldLabels = labels(["roleCode", "stepName", "actionName"]);
      return caseScopedSteps(row).map((step, index) => {
        const stepNo = step.stepNo ?? index + 1;
        const stepName = step.name || `s${stepNo}`;
        return {
          primaryKey: String(stepNo),
          label: stepName,
          fieldLabels,
          fields: { roleCode: step.roleCode || "-", stepName, actionName: actionName(catalogue, step.actionId) },
        };
      });
    },
    grantInForce: (id: string) => grantRows(id, "inForce"),
    grantSuperseded: (id: string) => grantRows(id, "superseded"),
    grantDirect: (id: string) => grantRows(id, "direct"),
    [`${ACTIVATE_WORKFLOW}.describe`]: () => describe(ACTIVATE_WORKFLOW),
    [`${DEACTIVATE_WORKFLOW}.describe`]: () => describe(DEACTIVATE_WORKFLOW),
    [`${DELETE_WORKFLOW}.describe`]: () => describe(DELETE_WORKFLOW),
  };
}
