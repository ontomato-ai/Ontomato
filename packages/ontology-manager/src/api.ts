import { BUILD_TEST_HEADER, type AppExecutionContext } from "@ontomato/contracts/build-tests";
import type { AppHostCredential } from "@ontomato/contracts/app-host";
import type { DataAdaptersData } from "@ontomato/contracts/data-adapters";
import type { ObjectViewDocument, ObjectViewState } from "@ontomato/contracts/object-views";
import type { PlatformTaskFrequency } from "@ontomato/contracts/platform-schedules";
import { createActionsClient } from "./clients/actions";
import { createProductsClient } from "./clients/products";
import type { DashboardDetail, DashboardListItem } from "@ontomato/contracts/dashboard";
import { createMetricViewsClient } from "./clients/metric-views";
import type { MessageKey, TextParams } from "./i18n";

/** The host's credential; its shape is the app host contract's, which apps outside our build also receive. */
export type ManagerCredential = AppHostCredential;

/**
 * The two data defaults supplied statically by the host. They pre-fill edit forms or are submitted with save payloads,
 * so they are data, not UI text, and do not change with the UI locale or credential type. Each shell passes its own
 * values (open source: "No business description provided", "Unnamed asset").
 */
export interface ManagerDataFallbacks {
  /** Description used when an object type has no (empty) business description. */
  readonly noBusinessDescription: string;
  /** Name used when a smart asset's name is not a string. */
  readonly unnamedAsset: string;
}

export interface ManagerRequestContext {
  readonly transport?: (path:string,init:RequestInit,service:string)=>Promise<Response>;
  /** Data engine proxy entry without a trailing slash; requests go to `${apiBase}/data-query/*`. */
  readonly apiBase: string;
  /** null means the host has cleared or not yet obtained a credential: no business request is sent and it is not treated as anonymous. */
  readonly credential: ManagerCredential | null;
  readonly executionContext?: AppExecutionContext;
  readonly locale: string;
  /** The request layer's own error texts in the current locale. */
  readonly text: (key: MessageKey, params?: TextParams) => string;
  readonly dataFallbacks: ManagerDataFallbacks;
}

/** 401 means authentication expired and 402 a license failure; the host decides how to handle them. */
export type ManagerAuthFailureStatus = 401 | 402;

function credentialIdentity(credential: ManagerCredential | null) {
  if (!credential) return null;
  switch (credential.type) {
    case "token":
      return `token:${credential.token}`;
    case "apiKey":
      return `apiKey:${credential.apiKey}`;
    case "anonymous":
      return "anonymous";
  }
}

/**
 * Host identity: API entry and credential (by value). A change means a different data source or user: the root component
 * rebuilds the workspace and the request layer drops stale responses. The locale is not part of the identity (as in the
 * original main system); it only sets Accept-Language on each request.
 */
export function hostSource(context: Pick<ManagerRequestContext, "apiBase" | "credential" | "executionContext">) {
  return JSON.stringify([context.apiBase, credentialIdentity(context.credential), context.executionContext?.kind === "build-test" ? context.executionContext.contextId : "live"]);
}

function credentialHeaders(credential: ManagerCredential): Record<string, string> {
  switch (credential.type) {
    case "token":
      return { tk: credential.token };
    case "apiKey":
      return { "x-api-key": credential.apiKey };
    case "anonymous":
      return {};
  }
}

export type SmartAssetKind = "metrics" | "actions" | "tasks";

const smartAssetPaths: Record<SmartAssetKind, string> = {
  metrics: "/metricView",
  actions: "/action",
  tasks: "/writeTask",
};

export interface OntologyAttribute {
  name: string;
  showName: string;
  type: string;
  attrDesc?: string;
  bizzkeyBool?: boolean;
  primaryKey?: boolean;
  enable?: boolean;
}

export interface OntologyObject {
  className: string;
  showName: string;
  classDesc: string;
  attrs: OntologyAttribute[];
}

export interface OntologyRelation {
  relationship: string;
  showName: string;
  fromclass: string;
  toclass: string;
  desc: string;
  fromField?: string;
  toField?: string;
}

/** A data instance node in the instance graph. */
export interface InstanceGraphNode {
  id: string;
  name: string;
  class: string;
  isCenter?: boolean;
}

/** A directed relation between two instance nodes. */
export interface InstanceGraphEdge {
  source: string;
  target: string;
  type?: string;
  label?: string;
}

export interface InstanceGraphData {
  nodes: InstanceGraphNode[];
  edges: InstanceGraphEdge[];
}

export interface InstanceGraphSummary {
  sampleToken?: string;
  classes: Array<{ class: string; instanceCount: number | null; sampleCount?: number }>;
  relationships: Array<{ source: string; target: string; count: number; type?: string; types?: string[] }>;
  nodeCount: number | null;
  edgeCount: number | null;
  componentCount: number;
  isolatedNodeCount: number;
  largestComponentSize: number;
  complete?: boolean;
  failures?: string[];
  relationTypes?: string[];
  overviewNodes?: InstanceGraphNode[];
  overviewEdges?: InstanceGraphEdge[];
  overviewEdgesTruncated?: boolean;
  version: string;
  generatedAt: string;
}

export interface InstanceNeighborhood extends InstanceGraphData {
   total: number | null;
  nextOffset: number | null;
  version: string;
}

/** The instance graph state the data engine reports; only READY carries data. */
export type InstanceGraphStatus = "READY" | "GENERATING" | "NOT_GENERATED";

export interface CreateOntologyObjectInput {
  className: string;
  /** Primary key attribute the backend saves with the class (an enabled varchar); must be id for the M3 data source. */
  primaryKeyName: string;
  showName: string;
  classDesc: string;
  /** Kept on the caller's draft; the owner's create interface sets these flags to false. */
  classToCard?: boolean;
  instanceToCard?: boolean;
  inStarChart?: boolean;
}

export interface CreateOntologyAttributeInput {
  className: string;
  name: string;
  showName: string;
  type: string;
  attrDesc: string;
  enable: boolean;
  bizzKey: boolean;
  primaryKey?: boolean;
}

export interface CreateOntologyRelationInput {
  relationship: string;
  fromclass: string;
  toclass: string;
  desc: string;
  /** Join fields submitted when visual modeling connects classes. */
  fromField?: string;
  toField?: string;
}

/** A business knowledge entry (the data engine KnowledgeEntity fields this page reads and writes); status 0 is pending review, 1 approved. */
export interface BusinessKnowledge {
  knowledgeID: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  status: number;
}

export interface SmartAsset {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  origin?: string;
  modifyTimestamp?: number;
  /** Subject id that created this asset; resolve to a name through the subject directory. */
  createdBy?: string | null;
  /** Subject id that last published it; publication is the review moment. */
  reviewedBy?: string | null;
  function?: { name?: string } | null;
  [key: string]: unknown;
}

/** One step of a workflow: the role that owns it and the action it runs. */
export type WorkflowScope = "all" | "self_organization" | "self_subtree" | "self_descendants" | "initiated_by_self" | "assigned_to_self";
export interface RunContractRecord {
  className: string; idField?: string; stepField?: string; statusField?: string;
  orgField?: string; initiatorField?: string; assigneeField?: string;
  statusOpen?: string[]; statusDone?: string[]; statusRejected?: string[];
  candidateField?: string; workflowRefField?: string;
}
export interface WorkflowStepRecord {
  stepNo?: number;
  name?: string;
  roleCode?: string;
  actionId?: string;
  actionType?: string;
  scope: WorkflowScope;
  actorPolicy?: {
    mode: "none" | "rule" | "agent";
    metricViewId?: string;
    metricRevision?: string;
    principalField?: string;
    parameters?: Record<string, unknown>;
    parameterBindings?: Record<string, string>;
    valueMap?: Record<string, string>;
    executionPrincipalId?: string;
    agentId?: string;
    instruction?: string;
  };
  invocationMode?: "manual" | "automatic";
  description?: string;
}

/**
 * An editable process definition. `status` reports its lifecycle and `version` its latest publication.
 * An active process can have unpublished edits, indicated by `hasDraft`.
 */
export interface WorkflowRecord {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  version?: number | null;
  hasDraft?: boolean;
  runClassName?: string | null;
  runContract?: RunContractRecord | null;
  temporary?: boolean | null;
  caseFormSchema?: Record<string, unknown> | null;
  steps?: WorkflowStepRecord[];
  /** Subject id that created the process. */
  createdBy?: string | null;
  /** Subject id on the most recent activation — this object's review moment. */
  reviewedBy?: string | null;
}

/** A capability grant and its current publication status. */
export interface CapabilityGrantRecord {
  roleId?: string | null;
  roleCode?: string | null;
  capabilityKind?: string | null;
  capabilityId?: string | null;
  capabilityVersion?: string | null;
  /**
   * The workflow whose activation wrote this row; null for a grant made directly.
   *
   * Without it a revision number alone says nothing: "version 1" is a different revision in every
   * workflow, so a page that groups grants by revision has to group by workflow first.
   */
  workflowId?: string | null;
  activatedByWorkflowVersion?: string | null;
  inForce: boolean;
  scope: { kind: WorkflowScope; field?: string; className?: string };
  stepNo?: number | null;
}

/** One subject of the domain and the roles in effect for them here. */
export interface SubjectRecord {
  id: string;
  loginCode?: string | null;
  displayName?: string | null;
  roleIds?: string[];
}

/**
 * One Trigger of this domain: a capability object, not a scheduled task of some application.
 *
 * <p>The platform's task table is a different thing — a personal schedule of an app's effect. A Trigger has a
 * condition kind, an effect kind, a status and a revision, and it is governed like every other capability.</p>
 */
export interface TriggerRecord {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  version?: number;
  conditionKind?: string | null;
  effectKind?: string | null;
  effect?: { actionId?: string; workflowId?: string } | null;
  /**
   * The stored condition, verbatim. A time condition's frequency has the platform scheduler's shape; the page words it
   * in the reader's language and the edit form restores it.
   */
  condition?: { frequency?: PlatformTaskFrequency | null; timeZone?: string } | null;
  enabled?: boolean;
  nextRunAt?: string | null;
  lastFiredAt?: string | null;
}

export type ManagerClient = ReturnType<typeof createManagerClient>;
export type ManagerRequest = ReturnType<typeof createManagerRequest>;

/**
 * Request layer to the platform API, one per Manager workspace instance or app page. Each request reads the current
 * context values. If apiBase or the credential changed by the time the response or its JSON arrives, the result is
 * dropped (AbortError) without notifying the host or delivering data; when only the locale changed, in-flight results
 * for the same identity are delivered and later requests carry the new locale. After dispose (workspace unmounted) no
 * request is sent, so stale follow-ups of confirmations or multi-step operations never go out with the new context.
 * Requests go to the data engine (`/data-query`) unless a call names another service prefix (`""` is the Node API).
 */
export function createManagerRequest(
  context: Omit<ManagerRequestContext, "dataFallbacks">,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  let disposed = false;
  const stale = () =>
    new DOMException(context.text("staleResponseDropped"), "AbortError");

  async function request(path: string, init: RequestInit = {}, service = "/data-query") {
    if (disposed) throw stale();
    const credential = context.credential;
    if (!credential) throw new Error(context.text("credentialMissing"));
    const source = hostSource(context);
    const assertCurrent = () => {
      if (disposed || hostSource(context) !== source) throw stale();
    };

    const execution=context.executionContext;
    // A bridged request is admitted by its host and by the resource owner. Direct Manager requests stay on the Java boundary.
    if(execution?.kind==="build-test" && service!=="/data-query" && !context.transport)
      throw Object.assign(new Error("This operation is not available for test-data preview"),{code:"BUILD_TEST_UNSUPPORTED"});
    const requestInit:RequestInit = {
      ...init,
      headers: {
        ...(init.headers as Record<string,string> | undefined),
        ...(init.method === "POST" && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        "Accept-Language": context.locale,
        "X-Requested-With": "XMLHttpRequest",
        ...credentialHeaders(credential),
        ...(service === "/data-query" && execution?.kind === "build-test"
          ? { [BUILD_TEST_HEADER]: JSON.stringify({kind:"build-test",contextId:execution.contextId}) } : {}),
      },
    };
    const response = context.transport?await context.transport(path,requestInit,service):await fetch(`${context.apiBase}${service}${path}`,requestInit);
    assertCurrent();
    if (response.status === 401 || response.status === 402) onAuthFailure(response.status);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      assertCurrent();
      // The refusal also carries the HTTP status and the owner's parsed body (`status`, `payload`, as the workbench's
      // request layer throws them), so a client that reads its owner's error contract can tell one refusal from another.
      throw Object.assign(new Error(response.status === 409 && path.startsWith("/objectView/") ? context.text("ovConflict") : body?.error?.message || body?.message ||
        context.text("requestFailedStatus", { status: response.status })),
        { code: body?.error?.code ?? body?.code, status: response.status, payload: body });
    }
    return response;
  }

  async function send(path: string, init: RequestInit, service = "/data-query") {
    const source = hostSource(context);
    const json = await (await request(path, init, service)).json();
    if (disposed || hostSource(context) !== source) throw stale();
    if (json?.success === false) {
      throw Object.assign(new Error(json.message || json.error || context.text("requestFailed")), { code: json.code });
    }
    return json;
  }

  const post = (path: string, body: Record<string, unknown>) =>
    send(path, { method: "POST", body: JSON.stringify(body) });

  return {
    request,
    send,
    post,
    text: context.text,
    dispose: () => {
      disposed = true;
    },
  };
}

/** The Manager's data engine client over its own request layer; see `createManagerRequest`. */
export function createManagerClient(
  context: ManagerRequestContext,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  const transport = createManagerRequest(context, onAuthFailure);
  const { request, send, post } = transport;

  function requestSmartAsset(
    kind: SmartAssetKind,
    operation: string,
    body: Record<string, unknown>
  ) {
    return post(`${smartAssetPaths[kind]}/${operation}`, body);
  }

  /** Raw metadata; data browsing and visual modeling read their own fields. */
  function getMetas() {
    return post("/admin/getMetas", {});
  }

  async function loadOntology() {
    const response = await getMetas();
    const data = response.data || {};
    const objects = (data.classDef || []).map((item: Record<string, any>) => ({
      className: item.className,
      showName: item.showName || item.classDesc || item.className,
      classDesc: item.classDesc || context.dataFallbacks.noBusinessDescription,
      attrs: (item.attrs || []).map((attr: Record<string, any>) => ({
        name: attr.name,
        showName: attr.showName || attr.name,
        type: attr.type || "string",
        attrDesc: attr.attrDesc || "",
        enable: attr.enable !== false && String(attr.enable || "").toLowerCase() !== "false",
        bizzkeyBool:
          attr.bizzkeyBool === true ||
          attr.bizzkey === true ||
          String(attr.bizzkey || "")
            .trim()
            .toLowerCase() === "true",
        primaryKey:
          attr.primaryKey === true ||
          attr.primary_key === true ||
          String(attr.primaryKey ?? attr.primary_key ?? "")
            .trim()
            .toLowerCase() === "true",
      })),
    })) as OntologyObject[];
    const relationSource = data.relationDef || data.relations || data.relationship_rule || [];
    const relations = (
      Array.isArray(relationSource)
        ? relationSource
        : Object.entries(relationSource).map(([relationship, relation]) => ({
            ...(relation as Record<string, unknown>),
            relationship,
          }))
    ).map((item: Record<string, any>) => ({
      relationship: item.relationship,
      showName:
        item.showName ||
        item.relationShowName ||
        item.relationshipShowName ||
        item.desc ||
        item.relationship,
      fromclass: item.fromclass,
      toclass: item.toclass,
      desc: item.desc || item.relationship,
      fromField: item.fromField,
      toField: item.toField,
    })) as OntologyRelation[];
    return { objects, relations };
  }

  function createOntologyObject(input: CreateOntologyObjectInput) {
    return post("/ontology/model/object-type/create", {
      className: input.className,
      primaryKeyName: input.primaryKeyName,
      showName: input.showName,
      classDesc: input.classDesc,
    });
  }

  async function updateOntologyObject(
    className: string,
    changes: { showName?: string; classDesc?: string }
  ) {
    // The owner saves the whole editable form; a caller that changed one field keeps the other from the stored model.
    const current =
      changes.showName === undefined || changes.classDesc === undefined
        ? ((await getMetas()).data?.classDef || []).find(
            (item: Record<string, unknown>) => item.className === className
          ) || {}
        : {};
    await post("/ontology/model/object-type/update", {
      className,
      showName: changes.showName ?? current.showName ?? "",
      classDesc: changes.classDesc ?? current.classDesc ?? "",
    });
  }

  function deleteOntologyObject(className: string) {
    return post("/ontology/model/object-type/delete", { className });
  }

  async function updateOntologyAttribute(
    className: string,
    attr: OntologyAttribute,
    changes: {
      showName?: string;
      attrDesc?: string;
      enable?: boolean;
      bizzkeyBool?: boolean;
      primaryKey?: boolean;
    }
  ) {
    await post("/ontology/model/attribute/update", {
      className,
      name: attr.name,
      showName: changes.showName ?? attr.showName,
      attrDesc: changes.attrDesc ?? attr.attrDesc ?? "",
      enable: changes.enable ?? attr.enable !== false,
      businessKey: changes.bizzkeyBool ?? Boolean(attr.bizzkeyBool),
    });
    if (changes.primaryKey) {
      await post("/ontology/model/attribute/primary-key", { className, name: attr.name });
    }
  }

  async function createOntologyAttribute(input: CreateOntologyAttributeInput) {
    await post("/ontology/model/attribute/create", {
      className: input.className,
      name: input.name,
      showName: input.showName,
      type: input.type,
      attrDesc: input.attrDesc,
      enable: input.enable,
      businessKey: input.bizzKey,
      primaryKey: input.primaryKey === true,
    });
  }

  function deleteOntologyAttribute(className: string, attrName: string) {
    return post("/ontology/model/attribute/delete", { className, name: attrName });
  }

  function updateOntologyRelation(relationship: string, changes: { desc: string; fromField: string; toField: string }) {
    return post("/ontology/model/relationship/update", { relationship, ...changes });
  }

  function createOntologyRelation(input: CreateOntologyRelationInput) {
    return post("/ontology/model/relationship/create", {
      relationship: input.relationship,
      fromclass: input.fromclass,
      toclass: input.toclass,
      desc: input.desc,
      fromField: input.fromField,
      toField: input.toField,
    });
  }

  function deleteOntologyRelation(relationName: string) {
    return post("/ontology/model/relationship/delete", { relationship: relationName });
  }

  /** search is submitted only when a non-empty keyword was entered in data browsing. */
  async function loadObjectData(
    className: string,
    page: number,
    pageSize: number,
    search?: string
  ) {
    const response = await post("/data/getWholeClassDataByPage", {
      classname: className,
      pagenum: page,
      pagecount: pageSize,
      search,
    });
    return {
      rows: Array.isArray(response.data) ? response.data : [],
      total: Number(response.total_count || 0),
    };
  }

  async function loadInstanceGraphSummary(): Promise<
    { status: "READY"; summary: InstanceGraphSummary } | { status: Exclude<InstanceGraphStatus, "READY"> }
  > {
    const response = await send("/data/instanceGraph/nodes", { method: "GET" });
    return response.status === "READY"
      ? { status: "READY", summary: response.data as InstanceGraphSummary }
      : { status: response.status };
  }

  async function loadInstanceGraphConnections(version: string, sampleToken?: string) {
    return (await post("/data/instanceGraph/connections", { version, sampleToken })).data as {
      overviewEdges: InstanceGraphEdge[]; overviewEdgesTruncated: boolean; version: string;
    };
  }

  async function loadInstanceGraphStatistics() {
    return (await send("/data/instanceGraph/statistics", { method: "GET" })).data as { nodeCount: number; classes: Array<{ class: string; instanceCount: number }> };
  }

  async function searchInstanceGraph(term: string, version: string, className?: string) {
    const response = await post("/data/instanceGraph/search", { term, version, class: className, limit: 50 });
    if (response.status !== "READY") throw new Error(context.text("instanceGraphNotGenerated"));
    return response.data as { nodes: InstanceGraphNode[]; hasMore: boolean; version: string };
  }

  async function loadInstanceNeighborhood(id: string, version: string, offset = 0, filters?: { relationType?: string; neighborClass?: string; direction?: string }) {
    const response = await post("/data/instanceGraph/neighborhood", { id, version, offset, limit: 100, ...filters });
    if (response.status !== "READY") throw new Error(context.text("instanceGraphNotGenerated"));
    return response.data as InstanceNeighborhood;
  }

  /** One instance's full record; the data engine returns classDef plus a flat attribute map. */
  async function queryInstanceInfo(id: string, className: string) {
    const response = await post("/data/queryInfoByNode", { id, class: className });
    const info = (response.data ?? {}) as Record<string, any>;
    const key = info.classDef?.attrs?.find((attr: Record<string, unknown>) => attr.primaryKey === true || attr.primary_key === true)?.name;
    if (key && info.data && typeof info.data === "object" && id.startsWith(`${className}:`)) {
      info.data = { ...info.data, [key]: id.slice(className.length + 1) };
    }
    return info as Record<string, unknown>;
  }

  async function objectViewRequest(operation: "read" | "edit" | "save" | "publish", className: string, form: "full" | "panel", values: Record<string, unknown> = {}): Promise<ObjectViewState> {
    if(form==='full'){
      const result=await send(`/product-assets/object-views/${operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({className,form,...values})},'');
      return result.data;
    }
    return (await post(`/objectView/${operation}`, { className, form, ...values })).data;
  }

  function saveObjectView(document: ObjectViewDocument, form: "full" | "panel", expectedRevision: number, description: string) {
    return objectViewRequest("save", document.className, form, { document, expectedRevision, description });
  }

  /** Every skill of the domain, for the capability overview. Charts are drawn from a chart file, not by a skill. */
  async function loadSkills() {
    const response = await send("/skills", { method: "GET" }, "");
    // Declared as a list, so an answer without one is an empty list rather than undefined: a caller that iterates
    // this must not have to know that the service can answer with a body of another shape.
    return Array.isArray(response.skills)
      ? (response.skills as Array<{ id: string; title: string }>)
      : [];
  }

  /**
   * The author's own dashboards and one dashboard's cards: the charts a view or a product chart can be brought in from.
   * Reading uses the author's own credentials, so no chart grant is involved.
   */
  async function loadDashboards() {
    const response = await send("/dashboards", { method: "GET" }, "");
    return (response.data ?? []) as DashboardListItem[];
  }

  async function loadDashboard(id: string) {
    const response = await send(`/dashboards/${encodeURIComponent(id)}`, { method: "GET" }, "");
    return response.data as DashboardDetail;
  }

  async function loadViewLinks(className: string, primaryKey: string, relationship: string, direction: "incoming" | "outgoing", offset: number) {
    const ontology = await loadOntology();
    const relation = ontology.relations.find(item => item.relationship === relationship);
    if (!relation || (direction === "outgoing" ? relation.fromclass : relation.toclass) !== className) throw new Error(context.text("ovInvalidRelation"));
    const targetClass = direction === "outgoing" ? relation.toclass : relation.fromclass;
    const source = ontology.objects.find(item => item.className === className);
    const target = ontology.objects.find(item => item.className === targetClass);
    const sourcePk = source?.attrs.find(attr => attr.primaryKey)?.name;
    const targetPk = target?.attrs.find(attr => attr.primaryKey)?.name;
    if (!sourcePk || !targetPk || !target) throw new Error(context.text("ovPrimaryKeyRequired"));
    const response = await post("/dsl/executeV1", { problem: "", answer: { steps: [{
      graph: { pattern_logic: "and", patterns: [{
        objects: [
          { idx: 0, variable: "source", class: className, conditions: { properties: { field: sourcePk, operator: "=", value: primaryKey } } },
          { idx: 1, variable: "target", class: targetClass },
        ],
        relationship: [{ from: direction === "outgoing" ? 0 : 1, to: direction === "outgoing" ? 1 : 0, type: [relationship] }],
      }] },
      output: { to_user: true, fields: target.attrs.filter(attr => attr.enable !== false).map(attr => ({ variable: "target", field: attr.name, as: attr.name })),
        sort: { fields: [{ variable: "target", field: targetPk, order: "asc" }] }, limit: { count: 51, offset } },
    }] } });
    if (response.error) throw new Error(String(response.error));
    const result = response.data?.[0]?.answer;
    if (!Array.isArray(result)) throw new Error(context.text("ovUnexpectedResponse"));
    return { rows: result.slice(0, 50) as Record<string, unknown>[], hasMore: result.length > 50, targetClass, targetPk };
  }

  async function loadSmartAssets(kind: SmartAssetKind) {
    const response = await post(`${smartAssetPaths[kind]}/queryList`, {});
    const source = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];
    return source.map((asset: Record<string, unknown>) => ({
      ...asset,
      id: typeof asset.id === "string" ? asset.id : undefined,
      name: typeof asset.name === "string" ? asset.name : context.dataFallbacks.unnamedAsset,
      description: typeof asset.description === "string" ? asset.description : null,
      status: typeof asset.status === "string" ? asset.status : undefined,
      origin: typeof asset.origin === "string" ? asset.origin : undefined,
      modifyTimestamp:
        typeof asset.modifyTimestamp === "number" ? asset.modifyTimestamp : undefined,
      createdBy: typeof asset.createdBy === "string" ? asset.createdBy : null,
      reviewedBy: typeof asset.reviewedBy === "string" ? asset.reviewedBy : null,
      function: asset.function as SmartAsset["function"],
    })) as SmartAsset[];
  }

  /** The current domain's adapter type and this edition's installed adapters; visual modeling uses the current type's requiresJoinFields to decide whether relations take join fields. */
  async function listDataAdapters(): Promise<DataAdaptersData> {
    return (await send("/businessConfig/dataAdapters", { method: "GET" })).data;
  }

  /** Business knowledge list: the data engine returns an object keyed by knowledgeID; older entries may have no tags. */
  async function listKnowledge(): Promise<BusinessKnowledge[]> {
    const response = await post("/admin/getBussinessKnowledge", {});
    const entries = response.data as Record<
      string,
      Omit<BusinessKnowledge, "knowledgeTags"> & { knowledgeTags?: string[] }
    >;
    return Object.values(entries).map((item) => ({
      knowledgeID: item.knowledgeID,
      knowledgeTitle: item.knowledgeTitle,
      knowledgeText: item.knowledgeText,
      knowledgeTags: item.knowledgeTags ?? [],
      status: item.status,
    }));
  }

  /**
   * Create (empty knowledgeID) or edit a business knowledge entry; answers the entry's id. A create's id is the store's
   * own — the page that filled a draft of it records that object for the draft — and an edit answers the id it saved.
   */
  async function saveKnowledge(knowledge: BusinessKnowledge): Promise<string> {
    const response = await post(
      knowledge.knowledgeID ? "/admin/editBussinessKnowledge" : "/admin/addBussinessKnowledge",
      { ...knowledge }
    );
    return knowledge.knowledgeID || (response.data as { id: string }).id;
  }

  function deleteKnowledge(knowledgeID: string) {
    return post("/admin/delBussinessKnowledge", { knowledgeID });
  }

  /** The domain's workflows; a workflow is a published unit of authority, not a running process. */
  async function loadWorkflows(): Promise<WorkflowRecord[]> {
    const response = await post("/workflow/query", {});
    const source = Array.isArray(response.data) ? response.data : [];
    return source as WorkflowRecord[];
  }

  /** Create (no id) or edit a draft workflow. A draft grants nothing until it is activated. */
  function saveWorkflow(workflow: WorkflowRecord) {
    return post("/workflow/save", { ...workflow });
  }

  /** Activation freezes a numbered revision and writes the grants its steps name. */
  function activateWorkflow(id: string) {
    return post("/workflow/activate", { id });
  }

  /** Deactivation withdraws only the grants the active revision wrote. */
  function deactivateWorkflow(id: string) {
    return post("/workflow/deactivate", { id });
  }

  function deleteWorkflow(id: string) {
    return post("/workflow/delete", { id });
  }

  /**
   * The capability grants in force in this domain.
   *
   * The executor only ever asks "may this subject run this action", so without this the stored grants
   * are write-only from the product's side and a published revision cannot be audited from the UI.
   */
  async function loadCapabilityGrants(): Promise<CapabilityGrantRecord[]> {
    const response = await post("/workflow/grants", {});
    const source = Array.isArray(response.data) ? response.data : [];
    return source as CapabilityGrantRecord[];
  }

  /** The domain's subjects with their effective roles; provenance ids resolve to names through this. */
  async function loadSubjects(): Promise<SubjectRecord[]> {
    const response = await post("/workflow/subjects", {});
    const source = Array.isArray(response.data) ? response.data : [];
    return source as SubjectRecord[];
  }

  /**
   * The domain's triggers, from the capability controller that owns them.
   *
   * <p>This used to read `/platform/scheduled-tasks`. That table is the kernel's schedule of an application's effect,
   * which is one condition kind — not the object an operator authors. Reading it here made the page look like it could
   * configure triggers when it was only listing somebody else's tasks.</p>
   */
  /**
   * Create or update a trigger.
   *
   * <p>The body is the capability object itself: condition and effect as the definition holds them. Publication is a
   * separate call, so an author can save a draft without arming it.</p>
   */
  async function saveTrigger(input: Record<string, unknown>) {
    const response = await post("/trigger/save", input);
    return response.data as TriggerRecord;
  }

  async function deleteTrigger(id: string) {
    await post("/trigger/delete", { id });
  }

  /** Publish or retire. Publishing arms: the definition is what an operator approved to run. */
  async function setTriggerStatus(id: string, status: "PUBLISHED" | "UNUSED" | "PENDING_REVIEW", enabled?: boolean) {
    const response = await post("/trigger/status", { id, status, ...(enabled === undefined ? {} : { enabled }) });
    return response.data as TriggerRecord;
  }

  async function loadTriggers(): Promise<TriggerRecord[]> {
    const response = await post("/trigger/queryList", {});
    const rows = Array.isArray(response.data) ? (response.data as Array<Record<string, unknown>>) : [];
    return rows.map((row) => {
      return {
        id: String(row.id ?? ""),
        name: typeof row.name === "string" && row.name.trim() ? row.name : String(row.id ?? ""),
        description: typeof row.description === "string" ? row.description : null,
        status: typeof row.status === "string" ? row.status : undefined,
        version: typeof row.version === "number" ? row.version : undefined,
        conditionKind: typeof row.conditionKind === "string" ? row.conditionKind : null,
        effectKind: typeof row.effectKind === "string" ? row.effectKind : null,
        effect: (row.effect ?? null) as TriggerRecord["effect"],
        condition: (row.condition ?? null) as TriggerRecord["condition"],
        enabled: row.enabled === true,
        nextRunAt: typeof row.nextRunAt === "string" ? row.nextRunAt : null,
        lastFiredAt: typeof row.lastFiredAt === "string" ? row.lastFiredAt : null,
      };
    });
  }

  return {
    /** The data engine's endpoints as the platform's shared pages read them (the agents' model pages): the `data`. */
    products: createProductsClient(transport),
    dataEngine: {
      get: async (path: string): Promise<unknown> => (await send(path, { method: "GET" })).data,
      put: async (path: string, body: unknown): Promise<unknown> =>
        (await send(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).data,
    },
    objectViewRequest,
    saveObjectView,
    /** Published MetricView reads: the same client apps get from the SDK. */
    metricViews: createMetricViewsClient(transport),
    /** Action execution: the same client apps get from the SDK. */
    actions: createActionsClient(transport),
    loadViewLinks,
    loadDashboards,
    loadDashboard,
    loadSkills,
    request,
    loadInstanceGraphStatistics,
    dispose: transport.dispose,
    requestSmartAsset,
    getMetas,
    loadOntology,
    createOntologyObject,
    updateOntologyObject,
    deleteOntologyObject,
    updateOntologyAttribute,
    createOntologyAttribute,
    deleteOntologyAttribute,
    updateOntologyRelation,
    createOntologyRelation,
    deleteOntologyRelation,
    loadObjectData,
    loadSmartAssets,
    loadInstanceGraphSummary,
    loadInstanceGraphConnections,
    searchInstanceGraph,
    loadInstanceNeighborhood,
    queryInstanceInfo,
    listDataAdapters,
    listKnowledge,
    saveKnowledge,
    deleteKnowledge,
    loadWorkflows,
    saveWorkflow,
    activateWorkflow,
    deactivateWorkflow,
    deleteWorkflow,
    loadCapabilityGrants,
    loadTriggers,
    saveTrigger,
    deleteTrigger,
    setTriggerStatus,
    loadSubjects,
  };
}
