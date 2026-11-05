import { workbenchProduct } from "../product/installed";
import { runtimeDefaults } from "../runtime/defaults";

const read = (name: string) => process.env[name];

export const environment = {
  node: () => read("NODE_ENV"),
  level: () => read("LOG_LEVEL"),
  logDir: () => read(workbenchProduct().logDirEnvName),
  pgConnection: () => {
    const explicit = read("DATABASE_URL") || read("PG_CONNECTION_STRING");
    if (explicit) return explicit;
    const url = new URL(runtimeDefaults().postgresFallback);
    url.hostname = read("POSTGRES_HOST") ?? url.hostname;
    url.port = read("POSTGRES_PORT") ?? url.port;
    if (read("POSTGRES_USER") !== undefined)
      url.username = encodeURIComponent(read("POSTGRES_USER")!);
    if (read("POSTGRES_PASSWORD") !== undefined)
      url.password = encodeURIComponent(read("POSTGRES_PASSWORD")!);
    return url.toString();
  },
  pgSchema: () => read("PG_SCHEMA") || "public",
  queryBase: () => read("DATA_QUERY_BASE_URL"),
  queryTimeout: () => parseInt(read("DATA_QUERY_TIMEOUT") || "30000", 10),
  queryKey: () => read("DATA_QUERY_API_KEY"),
  agentRuntime: () => ({
    queryServiceToken: read("ONTOMATO_QUERY_SERVICE_TOKEN") || "",
    url: read("AGENT_RUNTIME_URL") || "http://127.0.0.1:3001",
    token: read("AGENT_RUNTIME_SERVICE_TOKEN") || "",
    callbackUrl:
      read("AGENT_RUNTIME_CALLBACK_URL") ||
      `http://127.0.0.1:${read("PORT") || "3000"}`,
  }),
  chromium: () => read("CHROMIUM_EXECUTABLE_PATH") || undefined,
  retention: () => read("DIAGNOSIS_RETENTION_FILE"),
  observeNodes: () => read("OBSERVE_BACKEND_NODES") || read("BACKEND_NODES"),
  observeWorkspaces: () => read("OBSERVE_TRACE_WORKSPACE_ROOT"),
};
