// Local assembly for the independent public runtime; product wrappers supply the database name.
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseEnv as readDotEnv } from "node:util";
import { ensureRuntimeCredentials } from "./runtime-credentials.mjs";

// Runtime Python setup, shared by the development runtime entry points.
export function pythonExecutable(appDir, platform = process.platform) {
  return join(
    appDir,
    ".venv",
    ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
}

// The venv follows the runtime's requirements file: created with the host Python when missing and
// reinstalled when the file changes. The installed file's hash is kept inside the venv, so a venv
// created by hand is brought up to date once and then reused.
export function ensurePythonEnv(
  appDir,
  requirements,
  env = process.env,
  platform = process.platform,
) {
  const python = pythonExecutable(appDir, platform);
  const venv = join(appDir, ".venv");
  const marker = join(venv, "requirements.sha256");
  const hash = createHash("sha256")
    .update(readFileSync(requirements))
    .digest("hex");
  if (
    executable(python) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8") === hash
  )
    return python;
  if (!executable(python)) {
    const host = platform === "win32" ? ["py", "-3"] : ["python3"];
    runSetup(
      host[0],
      [...host.slice(1), "-m", "venv", venv],
      env,
      `Creating ${venv} with ${host.join(" ")}`,
    );
  }
  runSetup(
    python,
    ["-m", "pip", "install", "-r", requirements],
    env,
    `Installing ${requirements}`,
  );
  writeFileSync(marker, hash);
  return python;
}

function runSetup(command, args, env, description) {
  console.log(`[python] ${description}`);
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      `${description} failed${result.error ? `: ${result.error.message}` : ""}; Python 3.10+ is required`,
    );
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

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
  env.AGENT_RUNTIME_CALLBACK_URL ||= `http://127.0.0.1:${env.PORT || "3000"}`;
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
    },
  ]);
  env.AGENT_RUNTIME_DATABASE ||= runtimeDatabase;
  env.POSTGRES_HOST ||= "127.0.0.1";
  env.POSTGRES_PORT ||= "5432";
  env.ONTOMATO_QUERY_CALLBACK_URL ||= env.DATA_QUERY_BASE_URL;
  env.AGENT_RUNTIME_ROOT ||= join(root, "data/agent-runtime");
  env.AGENT_RUNTIME_HOST = "127.0.0.1";
  return env;
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
