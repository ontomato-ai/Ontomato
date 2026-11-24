import { HarnessRegistry } from "@ontomato/agent-runtime/adapters/registry";
import { piPlugin } from "@ontomato/agent-runtime/adapters/pi/index";
import type { SessionEngineSandboxFactory } from "@ontomato/agent-runtime/session-engines";
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
import { ModelGatewayProcess } from "@ontomato/agent-runtime/gateway-process";
import { ModelGatewayClient } from "@ontomato/agent-runtime/gateway-client";

function jsonSetting(name: "AGENT_RUNTIME_HOSTS" | "AGENT_CHANNEL_PROVIDERS") {
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
      domainHistory: z.boolean().optional(),
      channelGateway: z.boolean().optional(),
    }),
  )
  .min(1);
export async function startAgentRuntime(sandboxFactory: (store: RuntimeStore, root: string) => SessionEngineSandboxFactory) {
  const hosts = hostSchema.parse(jsonSetting("AGENT_RUNTIME_HOSTS"));
  const store = new RuntimeStore(
    databaseUrl(process.env),
    process.env.AGENT_RUNTIME_SCHEMA || "agent_runtime",
  );
  const listenHost = process.env.AGENT_RUNTIME_HOST || "127.0.0.1";
  const port = Number(process.env.AGENT_RUNTIME_PORT || 3001);
  const python = process.env.AGENT_RUNTIME_PYTHON || "python3";
  // The gateway runs the LiteLLM SDK in the skills environment's interpreter; every model call goes through it.
  const modelGateway = await ModelGatewayProcess.start(python);
  const root = path.resolve(process.env.AGENT_RUNTIME_ROOT || "data/agent-runtime");
  const runtime = new AgentRuntime({
    gateway: new ModelGatewayClient(modelGateway.addresses.controlUrl, modelGateway.addresses.dataUrl),
    worker: {
      development:
        process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
      python,
    },
    store,
    hosts,
    root,
    engineRegistry: new HarnessRegistry([piPlugin]),
    openEngineSandbox: sandboxFactory(store, root),
    modelRuntimeToken: process.env.ONTOMATO_MODEL_RUNTIME_TOKEN,
    modelSeed: { baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, modelName: process.env.LLM_MODEL },
    agentProviders: z.array(z.object({ id: z.string().min(1), hostId: z.string().min(1), url: z.string().url(), token: z.string().min(1) }).strict()).parse(jsonSetting("AGENT_CHANNEL_PROVIDERS")),
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
    port,
    listenHost,
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
    await modelGateway.stop();
    server.closeAllConnections();
  };
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
}

