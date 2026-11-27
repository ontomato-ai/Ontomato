import { z } from "zod";
import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { panelReadParameterSchemas, type PanelFormValues, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { readRefusal } from "../action/object-actions";
import type { ProductOwner } from "../product-governance/service-authentication";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import { describeServerOperation, panelServerOperation } from "../product-panels/server-operations";
import { defaultReadRegistration, ownerReadRegistration, presentedRegisteredDataRead, type ContextualReadyPayloadOptions, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
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
  activatedByWorkflowVersion: z.string().nullish(),
});
const workflowCountSchema = z.object({ total: z.number().int().nonnegative() });
const querySchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  cursor: panelReadParameterSchemas.cursor.optional(),
  size: panelReadParameterSchemas.size.optional(),
}).strict();

type Subject = z.infer<typeof subjectSchema>;
type Grant = z.infer<typeof grantSchema>;
type ActionCatalogue = z.infer<typeof actionSchema>[];
type WorkflowText = ReturnType<typeof workflowText>;

const subjectLabel = (subject: Subject) => subject.displayName || subject.loginCode || subject.id;
const grantRole = (grant: Grant) => grant.roleCode || grant.roleId || "-";
const caseScopedSteps = (workflow: Workflow) => (workflow.steps ?? []).filter(step => step.caseScoped === true);

const actionName = (catalogue: ActionCatalogue, id?: string | null) =>
  catalogue.find(action => action.id === (id ?? ""))?.name || id || "-";

function workflowFieldLabels(t: WorkflowText, names: readonly string[]) {
  return Object.fromEntries(names.map(name => [name, t(`fields.${name}`)]));
}

function caseScopedRows(workflow: Workflow, catalogue: ActionCatalogue, t: WorkflowText): PanelRecord[] {
  const fieldLabels = workflowFieldLabels(t, ["roleCode", "stepName", "actionName"]);
  return caseScopedSteps(workflow).map((step, index) => {
    const stepNo = step.stepNo ?? index + 1;
    const stepName = step.name || `s${stepNo}`;
    return {
      primaryKey: String(stepNo),
      label: stepName,
      fieldLabels,
      fields: { roleCode: step.roleCode || "-", stepName, actionName: actionName(catalogue, step.actionId) },
    };
  });
}

function groupedGrantRows(
  id: string, group: "inForce" | "superseded" | "direct", all: Grant[], catalogue: ActionCatalogue,
  t: WorkflowText, definition?: Workflow,
): PanelRecord[] {
  const stepActions = new Set(definition?.steps?.map(step => step.actionId));
  const rows = all.filter(grant => group === "direct"
    ? !grant.workflowId && grant.capabilityId != null && stepActions.has(grant.capabilityId)
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
  const fieldLabels = workflowFieldLabels(t, ["roleCode", "capabilities"]);
  return [...grouped].map(([roleCode, names]) => ({
    primaryKey: roleCode,
    label: roleCode,
    fieldLabels,
    fields: { roleCode, capabilities: [...names] },
    tags: { capabilities: [...names] },
    ...(group !== "inForce" && { tones: { capabilities: group === "direct" ? "success" : "info" } }),
  }));
}

const actionCatalogueSchema = z.array(actionSchema);
const grantListSchema = z.array(grantSchema);
const caseScopedPayloadSchema = z.object({ workflow: workflowSchema, actions: actionCatalogueSchema });
const grantRowsPayloadSchema = z.object({ grants: grantListSchema, actions: actionCatalogueSchema });
const directGrantPayloadSchema = grantRowsPayloadSchema.extend({ workflow: workflowSchema });

const workflowFormFactsSchema = z.object({ subjects: z.array(subjectSchema), actions: actionCatalogueSchema });
const workflowRecordFactsSchema = workflowFormFactsSchema.extend({ grants: grantListSchema.nullable() });
const workflowCatalogueFactsSchema = workflowRecordFactsSchema.extend({ workflows: z.array(workflowSchema) });
const workflowDetailFactsSchema = workflowRecordFactsSchema.extend({ workflow: workflowSchema });
const workflowEditFactsSchema = workflowFormFactsSchema.extend({ workflow: workflowSchema });
type WorkflowFormFacts = z.infer<typeof workflowFormFactsSchema>;
type WorkflowRecordFacts = z.infer<typeof workflowRecordFactsSchema>;
type WorkflowPaging = z.infer<typeof querySchema>;

function parseWorkflowPaging(params: Record<string, unknown>): WorkflowPaging {
  const paging = querySchema.parse(params);
  if (paging.cursor !== undefined && !/^\d+$/.test(paging.cursor))
    throw new HttpError(400, "The cursor does not name a position in the list", "INVALID_CURSOR");
  return paging;
}

function pageWorkflowRows(rows: PanelRecord[], { search, cursor, size }: WorkflowPaging): PanelRecordQuery {
  const offset = Number(cursor ?? 0);
  const term = search?.trim().toLowerCase();
  const kept = term ? rows.filter(row => [
    row.label, row.subtitle, row.fields.stepsSummary, row.fields.createdBy, row.fields.reviewedBy,
    row.fields.status, row.fields.hasDraftLabel,
  ].join(" ").toLowerCase().includes(term)) : rows;
  return {
    rows: kept.slice(offset, size === undefined ? undefined : offset + size),
    ...(size !== undefined && offset + size < kept.length && { nextCursor: String(offset + size) }),
    total: kept.length,
  };
}

function workflowRecordContext({ subjects, grants, actions }: WorkflowRecordFacts) {
  return {
    directory: subjects,
    subjectNames: new Map(subjects.map(subject => [subject.id, subjectLabel(subject)])),
    grants,
    catalogue: actions,
  };
}

function workflowFormOptions({ subjects, actions }: WorkflowFormFacts) {
  return {
    subjects: subjects.map(subject => ({
      value: subject.id,
      label: `${subjectLabel(subject)} (${subject.loginCode || subject.id})`,
    })),
    actions: actions.flatMap(action => action.id && (!action.status || action.status === "PUBLISHED")
      ? [{ value: action.id, label: action.name }] : []),
  };
}

function workflowReadMappers(t: WorkflowText) {
  function policyPrincipal(step: WorkflowStep, directory: Subject[]) {
    const configured = step.actorPolicy?.executionPrincipalId?.trim();
    if (!configured) return t("systemPrincipal");
    const subject = directory.find(candidate => candidate.id === configured || candidate.loginCode === configured);
    return subject ? `${subjectLabel(subject)} (${subject.loginCode || subject.id})` : configured;
  }

  function stepSummary(steps: WorkflowStep[], directory: Subject[], catalogue: ActionCatalogue) {
    if (!steps.length) return t("noSteps");
    return steps.map(step => {
      const actor = step.actorPolicy?.mode ?? "none";
      const invocation = t(`invocation.${stepInvocation(step)}`);
      const policy = actor === "none" ? "" : ` · ${t(`policy.${actor}`)} · ${policyPrincipal(step, directory)}`;
      const scoped = step.caseScoped ? ` · ${t("fields.caseScoped")}` : "";
      return `${step.name || actionName(catalogue, step.actionId)} [${invocation}${policy}${scoped}]`;
    }).join(" → ");
  }

  function recordRow(row: Workflow, context: ReturnType<typeof workflowRecordContext>): PanelRecord {
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
      fieldLabels: workflowFieldLabels(t, Object.keys(fields)),
      tones: { status: statusTone, statusBadges: statusTone, ...(noGrants && { grantsSummary: "warning" }) },
    };
  }

  return {
    list(rows: Workflow[], facts: WorkflowRecordFacts) {
      const context = workflowRecordContext(facts);
      return rows.map(row => recordRow(row, context));
    },
    record(row: Workflow, facts: WorkflowRecordFacts) {
      return recordRow(row, workflowRecordContext(facts));
    },
    form(row: Workflow, facts: WorkflowFormFacts) {
      const options = workflowFormOptions(facts);
      return workflowForm(t, options.actions, options.subjects, true, workflowFormValues(row));
    },
    createForm(facts: WorkflowFormFacts, values?: PanelFormValues) {
      const options = workflowFormOptions(facts);
      return workflowForm(t, options.actions, options.subjects, false, values);
    },
  };
}

export function prepareWorkflowPanelRead(
  { typeId, method, primaryKey }: { typeId: string; method: string; primaryKey?: string },
  params: Record<string, unknown>,
  locale?: string,
) {
  if (typeId !== WORKFLOW) return;
  const present = workflowReadMappers(workflowText(locale));
  const parameters: Record<string, string> = primaryKey === undefined ? {} : { primaryKey };
  const call = { type: WORKFLOW, name: method, parameters };
  const list = (payload: unknown) => {
    const facts = workflowCatalogueFactsSchema.parse(payload);
    return present.list(facts.workflows, facts);
  };
  switch (method) {
    case "list":
      return { call, present: list };
    case "query": {
      const paging = parseWorkflowPaging(params);
      return { call, present: (payload: unknown) => pageWorkflowRows(list(payload), paging) };
    }
    case "record":
      return {
        call,
        present(payload: unknown) {
          const facts = workflowDetailFactsSchema.parse(payload);
          return present.record(facts.workflow, facts);
        },
      };
    case "form":
      return {
        call,
        present(payload: unknown) {
          const facts = workflowEditFactsSchema.parse(payload);
          return present.form(facts.workflow, facts);
        },
      };
    case "createForm": {
      const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
      requireFormFieldNames(values, "values");
      return { call, present: (payload: unknown) => present.createForm(workflowFormFactsSchema.parse(payload), values) };
    }
  }
}

/** Presents the four successful workflow grant reads from the formal batch. */
export function createWorkflowPanelReadPresenter(locale?: string) {
  const t = workflowText(locale);
  function grouped(group: "inForce" | "superseded") {
    return (payload: unknown, { primaryKey }: { primaryKey: string }) => {
      const { grants, actions } = grantRowsPayloadSchema.parse(payload);
      return groupedGrantRows(primaryKey, group, grants, actions, t);
    };
  }
  return {
    grantCaseScopedSteps(payload: unknown) {
      const { workflow, actions } = caseScopedPayloadSchema.parse(payload);
      return caseScopedRows(workflow, actions, t);
    },
    grantInForce: grouped("inForce"),
    grantSuperseded: grouped("superseded"),
    grantDirect(payload: unknown) {
      const { workflow, grants, actions } = directGrantPayloadSchema.parse(payload);
      return groupedGrantRows(workflow.id, "direct", grants, actions, t, workflow);
    },
  };
}

export function createWorkflowReadAdapter(_reader: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const t = workflowText(viewer.locale);
  const present = workflowReadMappers(t);

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
  const actions = () => read("/action/queryList", {}, actionCatalogueSchema).catch(() => []);
  const grants = () => read("/workflow/grants", {}, grantListSchema).catch((error: unknown) => {
    throw new HttpError(error instanceof HttpError ? error.status : 502, t("grantsUnavailable"), "WORKFLOW_GRANTS_UNAVAILABLE", error);
  });

  async function recordContext(): Promise<WorkflowRecordFacts> {
    const [directory, grantRows, catalogue] = await Promise.all([subjects(), grants().catch(() => null), actions()]);
    return { subjects: directory, grants: grantRows, actions: catalogue };
  }

  async function list() {
    const [rows, facts] = await Promise.all([workflows(), recordContext()]);
    return present.list(rows, facts);
  }

  async function formFacts(): Promise<WorkflowFormFacts> {
    const [directory, catalogue] = await Promise.all([subjects(), actions()]);
    return { subjects: directory, actions: catalogue };
  }

  async function grantRows(id: string, group: "inForce" | "superseded" | "direct"): Promise<PanelRecord[]> {
    const [all, catalogue, definition] = await Promise.all([
      grants(), actions(), group === "direct" ? workflow(id) : undefined,
    ]);
    return groupedGrantRows(id, group, all, catalogue, t, definition);
  }

  const describe = (operation: string) =>
    describeServerOperation(panelServerOperation(operation), viewer.locale);

  return {
    list,
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const paging = parseWorkflowPaging(params);
      return pageWorkflowRows(await list(), paging);
    },
    async count() {
      const { total } = await read("/workflow/query", { countOnly: true }, workflowCountSchema);
      return { rows: [], total };
    },
    async record(id: string) {
      const [row, facts] = await Promise.all([workflow(id), recordContext()]);
      return present.record(row, facts);
    },
    async form(id: string) {
      const [row, facts] = await Promise.all([workflow(id), formFacts()]);
      return present.form(row, facts);
    },
    async createForm({ values }: { values?: PanelFormValues; changedField?: string | null }) {
      return present.createForm(await formFacts(), values);
    },
    async grantCaseScopedSteps(id: string): Promise<PanelRecord[]> {
      const [row, catalogue] = await Promise.all([workflow(id), actions(), grants()]);
      return caseScopedRows(row, catalogue, t);
    },
    grantInForce: (id: string) => grantRows(id, "inForce"),
    grantSuperseded: (id: string) => grantRows(id, "superseded"),
    grantDirect: (id: string) => grantRows(id, "direct"),
    [`${ACTIVATE_WORKFLOW}.describe`]: () => describe(ACTIVATE_WORKFLOW),
    [`${DEACTIVATE_WORKFLOW}.describe`]: () => describe(DEACTIVATE_WORKFLOW),
    [`${DELETE_WORKFLOW}.describe`]: () => describe(DELETE_WORKFLOW),
  };
}



const workflowReadyOptions: ContextualReadyPayloadOptions = ({ credentials }) => ({
  errorMessage: result => result.code === "WORKFLOW_NOT_FOUND" ? workflowText(credentials.locale)("notFound") : undefined,
});

export const workflowDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["list", "query", "record", "form", "createForm"] as const).map(method =>
    ownerReadRegistration(WORKFLOW, method, ({ selection, params, credentials }) =>
      prepareWorkflowPanelRead(selection, params, credentials.locale), workflowReadyOptions)),
  defaultReadRegistration(WORKFLOW, "count", workflowReadyOptions),
  ...(["grantCaseScopedSteps", "grantInForce", "grantSuperseded", "grantDirect"] as const).map(method =>
    presentedRegisteredDataRead(WORKFLOW, method, createWorkflowPanelReadPresenter, undefined, workflowReadyOptions)),
];
