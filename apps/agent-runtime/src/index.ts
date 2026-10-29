import { runtimeLogger } from "@ontomato/agent-runtime/logging";
import "dotenv/config";
import path from "node:path";
import { databaseUrl } from "./database.js";
import { z } from "zod";
import {
  AgentRuntime,
  RuntimeStore,
  createRuntimeHttp,
} from "@ontomato/agent-runtime";

function jsonSetting(name: "AGENT_RUNTIME_HOSTS") {
  try {
    return JSON.parse(process.env[name] || "[]") as unknown;
  } catch {
    // JSON.parse errors quote input; these settings can contain service credentials.
    throw new Error(`Invalid JSON in ${name}`);
  }
}

const hostSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      token: z.string().min(1),
      providers: z.array(z.string()),
      publishProviders: z.array(z.string()).optional(),
      domainSkills: z.boolean().optional(),
    }),
  )
  .min(1);
const hosts = hostSchema.parse(jsonSetting("AGENT_RUNTIME_HOSTS"));
const store = new RuntimeStore(
  databaseUrl(process.env),
  process.env.AGENT_RUNTIME_SCHEMA || "agent_runtime",
);
const runtime = new AgentRuntime({
  worker: {
    development:
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
    python: process.env.AGENT_RUNTIME_PYTHON || "python3",
  },
  store,
  hosts,
  root: path.resolve(process.env.AGENT_RUNTIME_ROOT || "data/agent-runtime"),
  ontologyUrl: z
    .string()
    .url()
    .parse(process.env.AGENT_RUNTIME_MODEL_CONFIG_URL),
  modelRuntimeToken: process.env.ONTOMATO_MODEL_RUNTIME_TOKEN,
  eventBufferSize: process.env.AGENT_RUNTIME_EVENT_BUFFER_SIZE
    ? z.coerce
        .number()
        .int()
        .positive()
        .parse(process.env.AGENT_RUNTIME_EVENT_BUFFER_SIZE)
    : undefined,
});
await runtime.initialize();
if (runtime.worker.development)
  runtimeLogger.warn(
    "Agent runtime development mode: worker UID isolation and per-worker process-count limits are disabled; Darwin lacks address-space rlimits and Windows lacks POSIX rlimits. This is not production isolation.\n",
  );
const server = createRuntimeHttp(runtime).listen(
  Number(process.env.AGENT_RUNTIME_PORT || 3001),
  process.env.AGENT_RUNTIME_HOST || "127.0.0.1",
  () => {
    runtimeLogger.info(
      `Agent runtime listening on ${JSON.stringify(server.address())}\n`,
    );
  },
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  await runtime.close();
  server.closeAllConnections();
};
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
