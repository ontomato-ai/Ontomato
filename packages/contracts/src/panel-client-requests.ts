import { platformSchedulesPath } from "./platform-schedules";
import { AGENT_DEFINITION, ATTRIBUTE, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SCHEDULED_TASK, SKILL, USER, BUSINESS_KNOWLEDGE, FEEDBACK_RECORD, KNOWLEDGE_GOVERNANCE_RECORD } from "./platform-object-types";

export { AGENT_DEFINITION, ATTRIBUTE, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SCHEDULED_TASK, SKILL, USER, BUSINESS_KNOWLEDGE, FEEDBACK_RECORD, KNOWLEDGE_GOVERNANCE_RECORD } from "./platform-object-types";

/*
 * The requests the SDK's platform clients send, by the binding that reaches each client (overall design 3.2, 5.1). A
 * projection binds a platform object type or a platform operation, and the client the SDK registers for that binding
 * (`apps-sdk/src/panel/schedules.ts`) is what a panel's components read and write through. This is the one place that
 * says which requests those clients make: the clients send nothing else, and the platform admits a panel frame's request
 * only when a binding of one of the panel's own projections declares it (`platform-web/src/app-host.ts`).
 *
 * It is the wire agreement between the two ends of the bridge — the SDK in the frame and the platform's host — so it is
 * a contract, which both import.
 */

/** The platform operation that runs one scheduled task now, as a projection binds it. */
export const RUN_NOW = "schedules.runNow";
export const DELETE_AGENT = "agents.delete";
export const DELETE_METRIC_VIEW = "metricViews.delete";
export const SET_METRIC_VIEW_STATUS = "metricViews.setStatus";
export const TEST_METRIC_VIEW = "metricViews.test";
export const TEST_EXECUTE_METRIC_VIEW = "metricViews.testExecute";
export const DELETE_FUNCTION = "functions.delete";
export const APPROVE_KNOWLEDGE = "knowledge.approve";
export const DELETE_KNOWLEDGE = "knowledge.delete";
export const DELETE_SKILL = "skills.delete";
export const IMPORT_SKILL = "skills.import";
export const EXPORT_SKILL = "skills.export";
export const EXPORT_FEEDBACK = "feedback.export";

/**
 * The gateway prefix the scheduled tasks' contract spells its paths with. A frame's request names the service and the
 * path inside it, as the platform's app host takes them, so the prefix becomes the service.
 */
export const DATA_QUERY_GATEWAY = "/api/data-query";

/** One request a client sends: its method, the platform service it goes to and the path inside that service. */
export interface ClientRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  service: "" | "/data-query";
  path: RegExp;
}

/** A binding as a projection record names it, `<kind>:<id>`: `PlatformObjectType:platform:ScheduledTask`. */
export const bindingKey = (binding: { kind: string; id: string }) => `${binding.kind}:${binding.id}`;

const tasks = platformSchedulesPath.slice(DATA_QUERY_GATEWAY.length);
/** Record routes accept UUIDs, never another named endpoint of the resource. */
const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const task = `${tasks}/${uuidPattern}`;

interface PanelClientRead extends ClientRequest {
  template: string;
  instructions?: string;
}

/** The owner reads shared by frames, the execution callback and the generated panel skill. */
export const scheduledTaskReads = [
  { method: "GET", service: "/data-query", path: new RegExp(`^${tasks}$`), template: tasks },
  { method: "GET", service: "/data-query", path: new RegExp(`^${task}$`), template: `${tasks}/:id` },
  {
    method: "POST",
    service: "/data-query",
    path: new RegExp(`^${tasks}/applications/[^/?]+/form$`),
    template: `${tasks}/applications/:appId/form`,
    instructions: "POST JSON with `values`, `changedField`, `taskId`, and `timeZone`. Read the task first for its appId, content and timeZone. Start with the task's content as values and null as changedField, then use the returned fields and values. Request the form again when an edited field changes it.",
  },
] as const satisfies readonly PanelClientRead[];

const agents = "/assistant/agent-definitions";
const agent = `${agents}/${uuidPattern}`;
const agentForm = `${agents}/form`;
const validateAgent = `${agents}/validate`;

const agentDefinitionReads = [
  { method: "GET", service: "", path: new RegExp(`^${agents}$`), template: agents },
  { method: "GET", service: "", path: new RegExp(`^${agent}$`), template: `${agents}/:id` },
  {
    method: "POST", service: "", path: new RegExp(`^${agentForm}$`), template: agentForm,
    instructions: "POST JSON with the form target, changedField, and optional values. Use the returned field paths and values.",
  },
  { method: "POST", service: "", path: new RegExp(`^${validateAgent}$`), template: validateAgent },
] as const satisfies readonly PanelClientRead[];

const ontologyMetadataRead = {
  method: "POST", service: "/data-query", path: /^\/admin\/getMetas$/, template: "/admin/getMetas",
  instructions: "POST an empty JSON object. Classes, their attributes and relationship rules come from this same response.",
} as const satisfies PanelClientRead;

/** Exact Java endpoints used by the managed definition clients. */
const dataQueryPost = (path: string) => ({
  method: "POST", service: "/data-query", path: new RegExp(`^${path}$`), template: path,
} as const);

const formReadInstructions = "POST JSON with the form target, changedField, and optional values. Use the returned fields and values.";
const metricViewDefinitionReads = [
  dataQueryPost("/metricView/queryList"),
  dataQueryPost("/metricView/queryById"),
  { ...dataQueryPost("/metricView/form"), instructions: formReadInstructions },
] as const satisfies readonly PanelClientRead[];
const functionDefinitionReads = [
  dataQueryPost("/function/queryList"),
  dataQueryPost("/function/queryById"),
  { ...dataQueryPost("/function/form"), instructions: formReadInstructions },
] as const satisfies readonly PanelClientRead[];

const knowledgeReads = [
  { method: "POST", service: "/data-query", path: /^\/admin\/getBussinessKnowledge$/, template: "/admin/getBussinessKnowledge" },
  {
    method: "POST", service: "/data-query", path: /^\/admin\/bussinessKnowledge\/form$/, template: "/admin/bussinessKnowledge/form",
    instructions: "POST a form target, changedField, and optional values. Use the owner's returned form description.",
  },
] as const satisfies readonly PanelClientRead[];

const governanceRecordReads = [
  {
    method: "GET", service: "/data-query", path: /^\/ontology\/ai\/knowledge-governance\/[^/?#]+\/work$/,
    template: "/ontology/ai/knowledge-governance/:id/work",
  },
  {
    method: "GET", service: "/data-query",
    path: /^\/ontology\/ai\/knowledge-governance\/[^/?#]+\/sources\/[^/?#]+(?:\?offset=\d+)?$/,
    template: "/ontology/ai/knowledge-governance/:id/sources/:source",
    instructions: "Use the record's source ID and the returned offset to read more source material.",
  },
] as const satisfies readonly PanelClientRead[];

const skillReads = [
  { method: "GET", service: "", path: /^\/assistant\/agent-skills$/, template: "/assistant/agent-skills" },
  { method: "GET", service: "", path: /^\/skills$/, template: "/skills" },
  { method: "GET", service: "", path: /^\/skills\/[^/?#]+\/references$/, template: "/skills/:id/references" },
  { method: "GET", service: "", path: /^\/skills\/[^/?#]+\/files$/, template: "/skills/:id/files" },
  {
    method: "GET", service: "", path: /^\/skills\/[^/?#]+\/file\?path=[^&#]+$/, template: "/skills/:id/file?path=:path",
    instructions: "Use the skill ID and the file path returned by its file list.",
  },
] as const satisfies readonly PanelClientRead[];

const feedbackReads = [
  {
    method: "GET", service: "", path: /^\/feedback(?:\?[^#]+)?$/, template: "/feedback",
    instructions: "Use sourceType, rating, and keyword to filter and limit and offset to page.",
  },
  { method: "GET", service: "", path: new RegExp(`^/feedback/${uuidPattern}$`), template: "/feedback/:id" },
] as const satisfies readonly PanelClientRead[];

const saveKnowledge = { method: "POST", service: "/data-query", path: /^\/admin\/editBussinessKnowledge$/ } as const satisfies ClientRequest;

const objectBinding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });
const readRequests: Readonly<Record<string, readonly PanelClientRead[]>> = {
  [objectBinding(SCHEDULED_TASK)]: scheduledTaskReads,
  [objectBinding(AGENT_DEFINITION)]: agentDefinitionReads,
  [objectBinding(SKILL)]: skillReads,
  [objectBinding(BUSINESS_KNOWLEDGE)]: knowledgeReads,
  [objectBinding(KNOWLEDGE_GOVERNANCE_RECORD)]: governanceRecordReads,
  [objectBinding(FEEDBACK_RECORD)]: feedbackReads,
  [objectBinding(MODEL_OPTION)]: [
    { method: "GET", service: "/data-query", path: /^\/model-options$/, template: "/model-options" },
  ],
  [objectBinding(MCP_SERVICE_OPTION)]: [
    { method: "GET", service: "", path: /^\/mcp\/services\/names$/, template: "/mcp/services/names" },
  ],
  [objectBinding(USER)]: [
    {
      method: "GET", service: "/data-query", path: /^\/platform\/agent-execution\/options(?:\?[^#]*)?$/,
      template: "/platform/agent-execution/options",
      instructions: "Use keyword, pageNum, and pageSize to list choices; use selected to resolve the current reference.",
    },
  ],
  [objectBinding(OBJECT_TYPE)]: [ontologyMetadataRead],
  [objectBinding(ATTRIBUTE)]: [ontologyMetadataRead],
  [objectBinding(RELATIONSHIP)]: [ontologyMetadataRead],
  [objectBinding(METRIC_VIEW)]: metricViewDefinitionReads,
  [objectBinding(FUNCTION)]: functionDefinitionReads,
};

export const panelClientReads = (binding: string): readonly PanelClientRead[] => readRequests[binding] ?? [];

/** Each binding's requests: what its client sends, and nothing more. */
export const clientRequests: Readonly<Record<string, readonly ClientRequest[]>> = {
  ...readRequests,
  [objectBinding(SCHEDULED_TASK)]: [
    // The reader's tasks, one task, its application's form for given values, and the save at the task's revision.
    ...scheduledTaskReads,
    { method: "PUT", service: "/data-query", path: new RegExp(`^${task}$`) },
  ],
  [bindingKey({ kind: "PlatformOperation", id: RUN_NOW })]: [
    { method: "POST", service: "/data-query", path: new RegExp(`^${task}/runs$`) },
  ],
  [objectBinding(AGENT_DEFINITION)]: [
    ...agentDefinitionReads,
    { method: "POST", service: "", path: new RegExp(`^${agents}$`) },
    { method: "PUT", service: "", path: new RegExp(`^${agent}$`) },
  ],
  [bindingKey({ kind: "PlatformOperation", id: DELETE_AGENT })]: [
    { method: "DELETE", service: "", path: new RegExp(`^${agent}$`) },
  ],
  [objectBinding(METRIC_VIEW)]: [...metricViewDefinitionReads, dataQueryPost("/metricView/save")],
  [objectBinding(FUNCTION)]: [...functionDefinitionReads, dataQueryPost("/function/save")],
  [bindingKey({ kind: "PlatformOperation", id: DELETE_METRIC_VIEW })]: [dataQueryPost("/metricView/delete")],
  [bindingKey({ kind: "PlatformOperation", id: SET_METRIC_VIEW_STATUS })]: [dataQueryPost("/metricView/setStatus")],
  [bindingKey({ kind: "PlatformOperation", id: TEST_METRIC_VIEW })]: [dataQueryPost("/metricView/test")],
  [bindingKey({ kind: "PlatformOperation", id: TEST_EXECUTE_METRIC_VIEW })]: [dataQueryPost("/metricView/testExecute")],
  [bindingKey({ kind: "PlatformOperation", id: DELETE_FUNCTION })]: [dataQueryPost("/function/delete")],
  [objectBinding(BUSINESS_KNOWLEDGE)]: [
    ...knowledgeReads,
    { method: "POST", service: "/data-query", path: /^\/admin\/addBussinessKnowledge$/ },
    saveKnowledge,
  ],
  [bindingKey({ kind: "PlatformOperation", id: APPROVE_KNOWLEDGE })]: [saveKnowledge],
  [bindingKey({ kind: "PlatformOperation", id: DELETE_KNOWLEDGE })]: [
    { method: "POST", service: "/data-query", path: /^\/admin\/delBussinessKnowledge$/ },
  ],
  [bindingKey({ kind: "PlatformOperation", id: DELETE_SKILL })]: [
    { method: "DELETE", service: "", path: /^\/skills\/[^/?#]+$/ },
  ],
  [bindingKey({ kind: "PlatformOperation", id: IMPORT_SKILL })]: [
    { method: "POST", service: "", path: /^\/skills\/import(?:\?overwrite=true)?$/ },
  ],
  [bindingKey({ kind: "PlatformOperation", id: EXPORT_SKILL })]: [
    { method: "GET", service: "", path: /^\/skills\/[^/?#]+\/export$/ },
  ],
  [bindingKey({ kind: "PlatformOperation", id: EXPORT_FEEDBACK })]: [
    { method: "GET", service: "", path: /^\/feedback\/export(?:\?[^#]+)?$/ },
  ],
};

/** Whether one of the given bindings' clients sends this request. */
export function clientSends(bindings: Iterable<string>, method: string, service: string, path: string): boolean {
  for (const binding of bindings)
    if (clientRequests[binding]?.some((request) => request.method === method && request.service === service && request.path.test(path)))
      return true;
  return false;
}
