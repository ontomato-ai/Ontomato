// Native replacement for POSIX-only environment assignments in package scripts.
// Uses the already installed development CLIs, not a second shell or dependency.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runtimeEnvironment, startDockerRuntime, waitForRuntime } from "./dev-runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";
const SKILL_BUILDERS = [
  "packages/workbench-server/report-skill/build.mjs",
  "packages/workbench-server/chart-skill/build.mjs",
  "packages/workbench-server/dashboard-skill/build.mjs",
];

/** Build generated workbench skill bundles before local dev server startup. */
export function buildWorkbenchSkills(root = ROOT) {
  for (const script of SKILL_BUILDERS) {
    execFileSync(process.execPath, [join(root, script)], { cwd: root, stdio: "inherit" });
  }
}

/** Prepare deployment-owned panels before the server can replace their database collection. */
export function buildWorkbenchPanels(root) {
  const require = createRequire(join(root, "apps/workbench/package.json"));
  const product = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
  execFileSync(process.execPath, [join(root, "apps/workbench/node_modules/@ontomato/apps-sdk/build.mjs"),
    "web/src/sdk-edition.ts", join(root, "dist/apps-sdk")], {
    cwd: join(root, "apps/workbench"), stdio: "inherit",
    env: { ...process.env, APPS_SDK_BUILD: JSON.stringify({ product, release: false }) },
  });
  execFileSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx/esm")).href,
    join(ROOT, "scripts/dev-panels.mjs"), root], { cwd: root, stdio: "inherit" });
}

// Pure: mode + product -> the child's env/tool/args/cwd.
// server/web pass the entry, config and root as absolute paths so a
// Windows process can be bound back to this checkout by its argv alone (no cwd).
export function configuration(mode, { root }, inherited = process.env) {
  const env = { ...inherited };
  let tool,
    args,
    cwd = root;
  switch (mode) {
    case "dev":
      env.NODE_ENV = "development";
      env.ONTOMATO_DEV_WAIT_FOR_SERVER = "1";
      tool = "concurrently";
      args = ["--kill-others-on-fail", "pnpm:dev:server", "pnpm:dev:web"];
      break;
    case "server":
      env.NODE_ENV = "development";
      tool = "tsx";
      args = ["watch", join(root, "apps/workbench/src/index.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    case "web":
      tool = "vite";
      args = ["--config", join(root, "apps/workbench/web/vite.config.ts")];
      cwd = resolve(root, "apps/workbench");
      break;
    default:
      throw new Error(`Unknown development command: ${mode}`);
  }
  return { env, tool, args, cwd };
}

export async function waitForWorkbench(url, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/health", url), {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // The workbench is still preparing or starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Workbench did not become ready at ${url} within ${timeout / 1000}s`);
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
  if (mode === "runtime") {
    const child = startDockerRuntime(product.root, ROOT, inherited, stdio);
    const release = holdForeground(child);
    child.once("error", error => { console.error(error.message); process.exitCode = 1; });
    child.once("close", (code, signal) => {
      release();
      if (setExitCode) process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
    });
    return child;
  }
  const settings = configuration(mode, product, inherited);
  const requireFromCwd = createRequire(resolve(settings.cwd, "package.json"));
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
    if (mode === "web" && process.env.ONTOMATO_DEV_WAIT_FOR_SERVER === "1") {
      const url = `http://127.0.0.1:${process.env.PORT || "3000"}`;
      console.log(`[dev] Waiting for workbench at ${url} before starting Vite`);
      await waitForWorkbench(url);
    }
    if (!["dev", "runtime", "server"].includes(mode)) {
      start(product);
      return;
    }
    if (mode === "dev" || mode === "server") {
      buildWorkbenchSkills();
    }
    // Combined dev starts this same server entry; prepare once, immediately before it starts.
    if (mode === "server") buildWorkbenchPanels(product.root);
    const env = runtimeEnvironment(product);
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
    await waitForRuntime(runtime, env.AGENT_RUNTIME_URL, 300_000);
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
