import { platformSchedulesPath } from "./platform-schedules";

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

/** The platform object type of the scheduled tasks, as a projection binds it. */
export const SCHEDULED_TASK = "platform:ScheduledTask";
/** The platform operation that runs one scheduled task now, as a projection binds it. */
export const RUN_NOW = "schedules.runNow";

export const AGENT_DEFINITION = "platform:AgentDefinition";
export const SKILL = "platform:Skill";
export const MODEL_OPTION = "platform:ModelOption";
export const MCP_SERVICE_OPTION = "platform:McpServiceOption";
export const USER = "platform:User";
export const OBJECT_TYPE = "platform:ObjectType";
export const RELATIONSHIP = "platform:Relationship";
export const DELETE_AGENT = "agents.delete";

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
  instructions: "POST an empty JSON object. Class definitions and relationship rules come from this same response.",
} as const satisfies PanelClientRead;

const objectBinding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });
const readRequests: Readonly<Record<string, readonly PanelClientRead[]>> = {
  [objectBinding(SCHEDULED_TASK)]: scheduledTaskReads,
  [objectBinding(AGENT_DEFINITION)]: agentDefinitionReads,
  [objectBinding(SKILL)]: [
    { method: "GET", service: "", path: /^\/assistant\/agent-skills$/, template: "/assistant/agent-skills" },
  ],
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
  [objectBinding(RELATIONSHIP)]: [ontologyMetadataRead],
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
};

/** Whether one of the given bindings' clients sends this request. */
export function clientSends(bindings: Iterable<string>, method: string, service: string, path: string): boolean {
  for (const binding of bindings)
    if (clientRequests[binding]?.some((request) => request.method === method && request.service === service && request.path.test(path)))
      return true;
  return false;
}
