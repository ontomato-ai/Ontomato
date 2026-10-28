import { ensurePythonEnv } from "./data-engine/dev-java.mjs";
// Native replacement for POSIX-only environment assignments in package scripts.
// Uses the already installed development CLIs, not a second shell or dependency.
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeEnvironment, waitForRuntime } from "./dev-runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

// Pure: mode + product -> the child's env/tool/args/cwd.
// server/web/manager pass the entry, config and root as absolute paths so a
// Windows process can be bound back to this checkout by its argv alone (no cwd).
export function configuration(mode, { root }, inherited = process.env) {
  const env = { ...inherited };
  let tool,
    args,
    cwd = root;
  switch (mode) {
    case "dev":
      env.NODE_ENV = "development";
      env.ONTOLOGY_MANAGER_URL = "http://localhost:5174";
      tool = "concurrently";
      args = ["pnpm:dev:server", "pnpm:dev:web", "pnpm:dev:ontology-manager"];
      break;
    case "server":
      env.NODE_ENV = "development";
      tool = "tsx";
      args = ["watch", join(root, "apps/workbench/src/index.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    case "runtime":
      env.NODE_ENV = "development";
      tool = "tsx";
      args = [
        "watch",
        join(ROOT, "apps/agent-runtime/src/index.ts"),
        "--dev-root",
        root,
      ];
      break;
    case "web":
      tool = "vite";
      args = ["--config", join(root, "apps/workbench/web/vite.config.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    case "manager":
      tool = "vite";
      args = [resolve(root, "apps/ontology-manager"), "--port", "5174"];
      cwd = resolve(root, "apps/ontology-manager");
      break;
    default:
      throw new Error(`Unknown development command: ${mode}`);
  }
  return { env, tool, args, cwd };
}

// Foreground child signal ownership, shared with the full-stack entry: Unix forwards SIGINT/SIGTERM
// to the child. Windows forward is impossible with child.kill (it is TerminateProcess there), and the
// console already delivered Ctrl-C to every attached process, so we only keep a listener alive until
// the child settles; a second Ctrl-C has no listener left and force-quits us.
export function holdForeground(child) {
  if (WINDOWS) {
    const hold = () => {};
    process.once("SIGINT", hold);
    process.once("SIGTERM", hold);
    return () => {
      process.removeListener("SIGINT", hold);
      process.removeListener("SIGTERM", hold);
    };
  }
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  return () => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  };
}

// Each mode resolves its CLI from that mode's own cwd, so the shared public
// helper never picks the public workspace's copy for a private entry.
export function start(
  product,
  mode = process.argv[2],
  inherited = process.env,
  stdio = "inherit",
  setExitCode = true,
) {
  const settings = configuration(mode, product, inherited);
  const toolRoot =
    mode === "runtime" ? join(ROOT, "apps/agent-runtime") : settings.cwd;
  const requireFromCwd = createRequire(resolve(toolRoot, "package.json"));
  const manifestPath = requireFromCwd.resolve(`${settings.tool}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry =
    typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin?.[settings.tool];
  if (!entry)
    throw new Error(
      `Missing ${settings.tool} CLI in ${settings.tool}; run pnpm install`,
    );
  const child = spawn(
    process.execPath,
    [
      resolve(dirname(manifestPath), entry),
      ...settings.args,
      ...process.argv.slice(3),
    ],
    { env: settings.env, cwd: settings.cwd, stdio, shell: false },
  );
  const release = holdForeground(child);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    release();
    if (setExitCode) process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
  return child;
}

export async function runCli(product) {
  let runtime;
  try {
    const mode = process.argv[2];
    if (!["dev", "runtime", "server"].includes(mode)) {
      start(product);
      return;
    }
    const env = runtimeEnvironment(product);
    if (mode === "dev" || mode === "runtime")
      env.AGENT_RUNTIME_PYTHON ||= ensurePythonEnv(
        join(product.root, "data/agent-runtime"),
        join(ROOT, "packages/agent-runtime/requirements-py310.txt"),
        env,
      );
    if (mode !== "dev") {
      start(product, mode, env);
      return;
    }
    const log = join(product.root, "data/agent-runtime/dev.log");
    mkdirSync(dirname(log), { recursive: true });
    const fd = openSync(log, "a", 0o600);
    try {
      runtime = start(product, "runtime", env, ["ignore", fd, fd], false);
    } finally {
      closeSync(fd);
    }
    await waitForRuntime(runtime, env.AGENT_RUNTIME_URL);
    console.log(`[dev] Agent runtime ready; log ${log}`);
    const frontend = start(product, "dev", env);
    frontend.once("close", () => runtime.kill("SIGTERM"));
    runtime.once("close", () => frontend.kill("SIGTERM"));
  } catch (error) {
    runtime?.kill("SIGTERM");
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runCli({ root: ROOT, runtimeDatabase: "ontomato" });
}
