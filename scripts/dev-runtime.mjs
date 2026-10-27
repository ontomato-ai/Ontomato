// Local assembly for the independent public runtime; product wrappers supply the database name.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDotEnv } from "./data-engine/dev-java.mjs";

export function runtimeEnvironment({ root, runtimeDatabase }, inherited = process.env) {
  const file = join(root, ".env");
  const env = { ...(existsSync(file) ? readDotEnv(readFileSync(file, "utf8")) : {}), ...inherited };
  if (!env.AGENT_RUNTIME_SERVICE_TOKEN) {
    const dir = join(root, ".secrets");
    const credentials = join(dir, "agent-runtime.env");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(credentials)) {
      writeFileSync(credentials, `AGENT_RUNTIME_SERVICE_TOKEN=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
      const readme = join(dir, "README.md");
      const line = "\n- agent-runtime.env: local workbench/runtime HTTP identity; no expiration; never commit.\n";
      writeFileSync(readme, line, { flag: "a" });
    }
    chmodSync(credentials, 0o600);
    env.AGENT_RUNTIME_SERVICE_TOKEN = readDotEnv(readFileSync(credentials, "utf8")).AGENT_RUNTIME_SERVICE_TOKEN;
  }
  if (!env.AGENT_RUNTIME_SERVICE_TOKEN) throw new Error("Missing AGENT_RUNTIME_SERVICE_TOKEN in local credential file");
  env.AGENT_RUNTIME_PORT ||= "3001";
  env.AGENT_RUNTIME_URL ||= `http://127.0.0.1:${env.AGENT_RUNTIME_PORT}`;
  env.AGENT_RUNTIME_CALLBACK_URL ||= `http://127.0.0.1:${env.PORT || "3000"}`;
  env.AGENT_RUNTIME_HOSTS ||= JSON.stringify([{ id: "workbench", token: env.AGENT_RUNTIME_SERVICE_TOKEN, providers: ["workbench"], publishProviders: ["workbench"], domainSkills: true }]);
  env.AGENT_RUNTIME_DATABASE ||= runtimeDatabase;
  env.POSTGRES_HOST ||= "127.0.0.1";
  env.POSTGRES_PORT ||= "5432";
  env.AGENT_RUNTIME_MODEL_CONFIG_URL ||= env.DATA_QUERY_BASE_URL;
  env.AGENT_RUNTIME_ROOT ||= join(root, "data/agent-runtime");
  env.AGENT_RUNTIME_HOST = "127.0.0.1";
  return env;
}

// Poll only while the child still belongs to this invocation; bounded startup, no request retry semantics.
export async function waitForRuntime(child, url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Agent runtime exited before readiness; see dev:logs runtime");
    try {
      const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* The child may still be initializing PostgreSQL. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error("Agent runtime readiness timeout; see dev:logs runtime");
}
