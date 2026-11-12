import { BUILD_TEST_HEADER, type AppExecutionContext } from "@ontomato/contracts/build-tests";
import type { AppHostCredential } from "@ontomato/contracts/app-host";
import type { DataAdaptersData } from "@ontomato/contracts/data-adapters";
import type { ObjectViewDocument, ObjectViewState } from "@ontomato/contracts/object-views";
import { createActionsClient } from "./clients/actions";
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

export type SmartAssetKind = "metrics" | "actions" | "functions" | "tasks";

const smartAssetPaths: Record<SmartAssetKind, string> = {
  metrics: "/metricView",
  actions: "/action",
  functions: "/function",
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
  /** Visual modeling submits false explicitly when creating a class. */
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
  description?: string;
}

/**
 * A business process published as one unit of authority. `status` is only a projection of the newest
 * event; `version` is the revision whose grants are in force.
 */
export interface WorkflowRecord {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  version?: number | null;
  runClassName?: string | null;
  runContract?: RunContractRecord | null;
  steps?: WorkflowStepRecord[];
  /** Subject id that created the process. */
  createdBy?: string | null;
  /** Subject id on the most recent activation — this object's review moment. */
  reviewedBy?: string | null;
}

/** One capability grant in force: which role may run which object. */
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
  scope: { kind: WorkflowScope; field?: string; className?: string };
  stepNo?: number | null;
}

/**
 * One role and the platform operations it may call.
 *
 * `apiPermissions` is empty for a management role: it holds every enabled operation by rule rather
 * than by listed rows, and expanding that list here would go stale as endpoints are added.
 */
export interface PlatformAccessRecord {
  roleId?: string | null;
  roleCode?: string | null;
  apiPermissions?: string[];
  managementRole?: boolean;
}

/** One subject of the domain and the roles in effect for them here. */
export interface SubjectRecord {
  id: string;
  loginCode?: string | null;
  displayName?: string | null;
  roleIds?: string[];
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
    if(execution?.kind==="build-test" && service!=="/data-query")
      throw Object.assign(new Error("This operation is not available for test-data preview"),{code:"BUILD_TEST_UNSUPPORTED"});
    const response = await fetch(`${context.apiBase}${service}${path}`, {
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
    });
    assertCurrent();
    if (response.status === 401 || response.status === 402) onAuthFailure(response.status);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      assertCurrent();
      throw Object.assign(new Error(response.status === 409 && path.startsWith("/objectView/") ? context.text("ovConflict") : body?.error?.message || body?.message ||
        context.text("requestFailedStatus", { status: response.status })),
        { code: body?.error?.code ?? body?.code });
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
    return post("/admin/addClass", { ...input });
  }

  async function updateOntologyObject(
    className: string,
    changes: { showName?: string; classDesc?: string }
  ) {
    const requests: Promise<unknown>[] = [];
    if (changes.showName !== undefined) {
      requests.push(post("/admin/editClassShowName", { className, showName: changes.showName }));
    }
    if (changes.classDesc !== undefined) {
      requests.push(post("/admin/editClassDesc", { className, desc: changes.classDesc }));
    }
    await Promise.all(requests);
  }

  function deleteOntologyObject(className: string) {
    return post("/admin/delClass", { className });
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
    const requests: Promise<unknown>[] = [];
    if (changes.showName !== undefined) {
      requests.push(
        post("/admin/editClassAttrShowName", {
          className,
          attr: attr.name,
          showName: changes.showName,
        })
      );
    }
    if (changes.attrDesc !== undefined || changes.enable !== undefined) {
      requests.push(
        post("/admin/editClassAttrDesc", {
          className,
          attr: attr.name,
          desc: changes.attrDesc ?? attr.attrDesc ?? "",
          enable: String(changes.enable ?? attr.enable ?? true),
        })
      );
    }
    if (changes.bizzkeyBool !== undefined) {
      requests.push(
        post("/admin/editClassAttrShouldReturn", {
          className,
          attr: attr.name,
          shouldReturn: changes.bizzkeyBool,
        })
      );
    }
    if (changes.primaryKey) {
      requests.push(post("/admin/editClassAttrPrimaryKey", { className, attr: attr.name }));
    }
    await Promise.all(requests);
  }

  async function createOntologyAttribute(input: CreateOntologyAttributeInput) {
    await post("/admin/addClassAttr", {
      className: input.className,
      attrName: input.name,
      showName: input.showName,
      attrDesc: input.attrDesc,
      type: input.type,
      bizzKey: input.bizzKey,
      enable: input.enable,
    });

    if (input.primaryKey) {
      await post("/admin/editClassAttrPrimaryKey", {
        className: input.className,
        attr: input.name,
      });
    }
  }

  function deleteOntologyAttribute(className: string, attrName: string) {
    return post("/admin/delClassAttr", { className, attrName });
  }

  function updateOntologyRelation(relationship: string, changes: { desc: string; fromField: string; toField: string }) {
    return post("/admin/editRelationshipDesc", { relationship, ...changes });
  }

  function createOntologyRelation(input: CreateOntologyRelationInput) {
    return post("/admin/addRelationship", {
      relationName: input.relationship,
      fromClassName: input.fromclass,
      toClassName: input.toclass,
      relationDesc: input.desc,
      fromField: input.fromField,
      toField: input.toField,
    });
  }

  function deleteOntologyRelation(relationName: string) {
    return post("/admin/delRelationship", { relationName });
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
    return (await post(`/objectView/${operation}`, { className, form, ...values })).data;
  }

  function saveObjectView(document: ObjectViewDocument, form: "full" | "panel", expectedRevision: number, description: string) {
    return objectViewRequest("save", document.className, form, { document, expectedRevision, description });
  }

  async function loadViewSkills() {
    const response = await send("/skills", { method: "GET" }, "");
    return (response.skills as Array<{ id: string; title?: string; type: string; category: string }>).filter(skill => skill.type === "executable" && skill.category === "visualization");
  }

  async function renderViewSkill(id: string, input: Record<string, unknown>) {
    const response = await send(`/skills/${encodeURIComponent(id)}/render`, { method: "POST", body: JSON.stringify({ input }) }, "");
    return String(response.result.html);
  }

  function viewSkillHtml(html: string) {
    return html.replace(/(["'])(\/api\/(?:skills\/resources|echart)\/[^"'<>\s]+)\1/g, (_match, quote: string, resource: string) => {
      const url = new URL(resource, "http://skill.local");
      if (url.pathname.endsWith("/echarts/scripts/echarts.min.js")) return `${quote}${context.apiBase}/echart/echarts.min.js${quote}`;
      url.searchParams.delete("tk"); url.searchParams.delete("apiKey");
      if (context.credential?.type === "token") url.searchParams.set("tk", context.credential.token);
      if (context.credential?.type === "apiKey") url.searchParams.set("apiKey", context.credential.apiKey);
      return `${quote}${context.apiBase}${url.pathname.slice(4)}${url.search}${quote}`;
    });
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

  /** Create (empty knowledgeID) or edit a business knowledge entry. */
  function saveKnowledge(knowledge: BusinessKnowledge) {
    return post(
      knowledge.knowledgeID ? "/admin/editBussinessKnowledge" : "/admin/addBussinessKnowledge",
      { ...knowledge }
    );
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

  /** Which roles hold which platform operations, as the request interceptor enforces them. */
  async function loadPlatformAccess(): Promise<PlatformAccessRecord[]> {
    const response = await post("/workflow/platform-access", {});
    const source = Array.isArray(response.data) ? response.data : [];
    return source as PlatformAccessRecord[];
  }

  /** The domain's subjects with their effective roles; provenance ids resolve to names through this. */
  async function loadSubjects(): Promise<SubjectRecord[]> {
    const response = await post("/workflow/subjects", {});
    const source = Array.isArray(response.data) ? response.data : [];
    return source as SubjectRecord[];
  }

  return {
    objectViewRequest,
    saveObjectView,
    /** Published MetricView reads: the same client apps get from the SDK. */
    metricViews: createMetricViewsClient(transport),
    /** Action execution: the same client apps get from the SDK. */
    actions: createActionsClient(transport),
    loadViewLinks,
    loadViewSkills,
    renderViewSkill,
    viewSkillHtml,
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
    loadPlatformAccess,
    loadSubjects,
  };
}
