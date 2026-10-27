import "dotenv/config";
import path from "node:path";
import { z } from "zod";
import {
  AgentRuntime,
  RuntimeStore,
  createRuntimeHttp,
} from "@ontomato/agent-runtime";

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
const hosts = hostSchema.parse(
  JSON.parse(process.env.AGENT_RUNTIME_HOSTS || "[]"),
);
const store = new RuntimeStore(
  z.string().min(1).parse(process.env.AGENT_RUNTIME_DATABASE_URL),
  process.env.AGENT_RUNTIME_SCHEMA || "agent_runtime",
);
const runtime = new AgentRuntime({
  store,
  hosts,
  root: path.resolve(process.env.AGENT_RUNTIME_ROOT || "data/agent-runtime"),
  ontologyUrl: z
    .string()
    .url()
    .parse(process.env.AGENT_RUNTIME_MODEL_CONFIG_URL),
  modelRuntimeToken: process.env.ONTOMATO_MODEL_RUNTIME_TOKEN,
  maxArtifactBytes: process.env.AGENT_RUNTIME_MAX_ARTIFACT_BYTES
    ? z.coerce
        .number()
        .int()
        .positive()
        .parse(process.env.AGENT_RUNTIME_MAX_ARTIFACT_BYTES)
    : undefined,
  mcpServers: z
    .array(
      z.object({
        id: z.string(),
        url: z.string().url(),
        transport: z.enum(["sse", "streamable-http"]),
        headers: z.record(z.string()).optional(),
        hosts: z.array(z.string()),
      }),
    )
    .parse(JSON.parse(process.env.AGENT_RUNTIME_MCP_SERVERS || "[]")),
  eventBufferSize: process.env.AGENT_RUNTIME_EVENT_BUFFER_SIZE
    ? z.coerce
        .number()
        .int()
        .positive()
        .parse(process.env.AGENT_RUNTIME_EVENT_BUFFER_SIZE)
    : undefined,
});
await runtime.initialize();
const server = createRuntimeHttp(runtime).listen(
  Number(process.env.AGENT_RUNTIME_PORT || 3001),
  process.env.AGENT_RUNTIME_HOST || "127.0.0.1",
  () => {
    process.stdout.write(
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
