// Local assembly for the independent public runtime; product wrappers supply the database name.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parseEnv as readDotEnv } from "node:util";
import { ensureRuntimeCredentials } from "./runtime-credentials.mjs";

export function runtimeEnvironment(
  { root, runtimeDatabase },
  inherited = process.env,
) {
  const file = join(root, ".env");
  const env = {
    ...(existsSync(file) ? readDotEnv(readFileSync(file, "utf8")) : {}),
    ...inherited,
  };
  ensureRuntimeCredentials(root, env);
  env.AGENT_RUNTIME_PORT ||= "3001";
  env.AGENT_RUNTIME_URL ||= `http://127.0.0.1:${env.AGENT_RUNTIME_PORT}`;
  env.AGENT_RUNTIME_CALLBACK_URL ||= `http://host.docker.internal:${env.PORT || "3000"}`;
  env.AGENT_CHANNEL_PROVIDERS ||= JSON.stringify([
    {id:"workbench",hostId:"workbench",url:env.AGENT_RUNTIME_CALLBACK_URL.replace(/\/$/,"")+"/internal/agent-channel",token:env.ONTOMATO_QUERY_SERVICE_TOKEN},
    {id:"observe",hostId:"workbench",url:env.AGENT_RUNTIME_CALLBACK_URL.replace(/\/$/,"")+"/internal/agent-channel",token:env.ONTOMATO_QUERY_SERVICE_TOKEN},
    {id:"ontology",hostId:"ontology",url:(env.DATA_QUERY_BASE_URL||"http://127.0.0.1:18087").replace(/\/$/,"")+"/platform/agent-channel",token:env.ONTOMATO_QUERY_SERVICE_TOKEN},
  ]);
  env.AGENT_RUNTIME_HOSTS ||= JSON.stringify([
    {
      id: "workbench",
      token: env.AGENT_RUNTIME_SERVICE_TOKEN,
      providers: ["workbench", "ontology"],
      publishProviders: ["workbench"],
      domainSkills: true,
    },
    {
      id: "ontology",
      token: env.AGENT_RUNTIME_ONTOLOGY_TOKEN,
      providers: ["ontology"],
      publishProviders: ["ontology"],
      domainHistory: true,
      channelGateway: true,
    },
  ]);
  env.AGENT_RUNTIME_DATABASE ||= runtimeDatabase;
  env.POSTGRES_HOST ||= "127.0.0.1";
  env.POSTGRES_PORT ||= "5432";
  env.AGENT_RUNTIME_ROOT ||= join(root, "data/agent-runtime");
  env.AGENT_RUNTIME_HOST = "127.0.0.1";
  return env;
}

export function dockerHostUrl(value) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = "host.docker.internal";
  return url.href;
}

export function startDockerRuntime(root, publicRoot, env, stdio) {
  const policy = join(publicRoot, "apps/agent-runtime/sandbox-policy");
  const image = env.AGENT_RUNTIME_DEV_IMAGE || "ghcr.io/ontomato-ai/ontomato-agent-runtime:edge";
  const port = env.AGENT_RUNTIME_PORT;
  const containerEnv = {
    AGENT_RUNTIME_DATABASE: env.AGENT_RUNTIME_DATABASE,
    AGENT_RUNTIME_SCHEMA: env.AGENT_RUNTIME_SCHEMA,
    AGENT_RUNTIME_HOSTS: env.AGENT_RUNTIME_HOSTS,
    AGENT_CHANNEL_PROVIDERS: JSON.stringify(JSON.parse(env.AGENT_CHANNEL_PROVIDERS).map(provider => ({
      ...provider, url: dockerHostUrl(provider.url),
    }))),
    AGENT_RUNTIME_DATABASE_URL: env.AGENT_RUNTIME_DATABASE_URL && dockerHostUrl(env.AGENT_RUNTIME_DATABASE_URL),
    POSTGRES_HOST: ["localhost", "127.0.0.1", "::1"].includes(env.POSTGRES_HOST) ? "host.docker.internal" : env.POSTGRES_HOST,
    POSTGRES_PORT: env.POSTGRES_PORT,
    POSTGRES_USER: env.POSTGRES_USER,
    POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
    ONTOMATO_MODEL_RUNTIME_TOKEN: env.ONTOMATO_MODEL_RUNTIME_TOKEN,
    LLM_BASE_URL: env.LLM_BASE_URL && dockerHostUrl(env.LLM_BASE_URL),
    LLM_API_KEY: env.LLM_API_KEY,
    LLM_MODEL: env.LLM_MODEL,
    AGENT_RUNTIME_EVENT_BUFFER_SIZE: env.AGENT_RUNTIME_EVENT_BUFFER_SIZE,
  };
  mkdirSync(env.AGENT_RUNTIME_ROOT, { recursive: true });
  // Native development previously used UID 0. Initialize its missing counter without replacing an existing one.
  // The container still validates the counter against assigned UIDs before accepting work.
  try {
    writeFileSync(join(env.AGENT_RUNTIME_ROOT, "worker-next-uid"), "20000\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const envArgs = Object.entries(containerEnv).flatMap(([name, value]) => value === undefined ? [] : ["--env", name]);
  return spawn("docker", ["run", "--rm", "--init", "--pull=missing",
    "--label", `dev.stack.root=${root}`,
    "--label", "dev.stack.service=agent-runtime",
    "--add-host", "host.docker.internal:host-gateway",
    "--publish", `127.0.0.1:${port}:3001`,
    "--cap-add", "SYS_ADMIN", "--cap-add", "NET_ADMIN",
    "--security-opt", `seccomp=${join(policy, "seccomp.json")}`,
    "--security-opt", env.AGENT_RUNTIME_LSM || "no-new-privileges=true",
    "--mount", `type=bind,source=${env.AGENT_RUNTIME_ROOT},target=/data`,
    "--mount", `type=bind,source=${join(policy, "probe.py")},target=/usr/local/lib/ontomato-sandbox/probe.py,readonly`,
    ...envArgs, image,
  ], { cwd: root, stdio, env: { ...process.env, ...containerEnv } });
}

// Poll only while the child still belongs to this invocation; bounded startup, no request retry semantics.
export async function waitForRuntime(child, url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        "Agent runtime exited before readiness; see dev:logs runtime",
      );
    try {
      const response = await fetch(new URL("/health", url), {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      /* The child may still be initializing PostgreSQL. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Agent runtime readiness timeout; see dev:logs runtime");
}
