import { RuntimeError } from "./errors";
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  codeLimitsSchema,
  type CodeLimits,
} from "@ontomato/contracts/agent-runtime-code";

export interface WorkerPolicy {
  development: boolean;
  python: string;
  uidStatePath?: string;
}
const allocations = new Map<string, Promise<number>>();
const workerUids = new WeakMap<ChildProcess, number>();
export async function allocateUid(file: string): Promise<number> {
  const previous = allocations.get(file) ?? Promise.resolve(0);
  const next = previous
    .catch(() => 0)
    .then(async () => {
      let uid = 20000;
      try {
        uid = Number(await readFile(file, "utf8"));
      } catch (error) {
        if ((error as Error & { code?: string }).code !== "ENOENT") throw error;
      }
      if (!Number.isSafeInteger(uid) || uid < 20000 || uid >= 2147483646)
        throw new Error("Worker UID state is invalid or exhausted");
      await writeFile(file + ".tmp", String(uid + 1), { mode: 0o600 });
      await rename(file + ".tmp", file);
      return uid;
    });
  allocations.set(file, next);
  return next;
}
export function assertWorkerPolicy(policy: WorkerPolicy) {
  if (
    !policy.development &&
    (process.platform !== "linux" || process.getuid?.() !== 0)
  )
    throw new RuntimeError(
      503,
      "CODE_ISOLATION_UNAVAILABLE",
      "Production workers require Linux and privilege switching",
    );
}
async function ownTree(directory: string, uid: number) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink())
    throw new Error("Worker workspace cannot contain symbolic links");
  if (stat.isDirectory()) {
    for (const name of await readdir(directory))
      await ownTree(path.join(directory, name), uid);
  } else if (!stat.isFile())
    throw new Error("Worker workspace contains a non-regular file");
  await chown(directory, uid, uid);
  await chmod(directory, stat.isDirectory() ? 0o700 : 0o600);
}
export async function workerIdentity(policy: WorkerPolicy, workspace: string) {
  assertWorkerPolicy(policy);
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  if (policy.development) return { uid: undefined, release: async () => {} };
  if (!policy.uidStatePath)
    throw new RuntimeError(
      503,
      "CODE_ISOLATION_UNAVAILABLE",
      "Worker UID persistence is required",
    );
  const uid = await allocateUid(policy.uidStatePath);
  await ownTree(workspace, uid);
  return {
    uid,
    release: async () => {
      await chown(workspace, 0, 0);
      await chmod(workspace, 0o700);
    },
  };
}
/** Private, read-only provider files outside the writable execution workspace. */
export async function workerAssets(
  policy: WorkerPolicy,
  uid: number | undefined,
  source: string,
  destination: string,
) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  async function copy(from: string, to: string) {
    const stat = await lstat(from);
    if (stat.isSymbolicLink())
      throw new Error("Provider assets cannot contain symbolic links");
    if (stat.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 });
      for (const name of await readdir(from))
        await copy(path.join(from, name), path.join(to, name));
    } else if (stat.isFile())
      await writeFile(to, await readFile(from), { mode: 0o600 });
    else throw new Error("Provider asset must be a regular file");
    if (!policy.development) await chown(to, 0, uid!);
    await chmod(to, stat.isDirectory() ? 0o550 : 0o440);
  }
  await copy(source, destination);
}
export async function removeWorkerFiles(directory: string) {
  async function writable(file: string) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return;
    await chmod(file, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory())
      for (const name of await readdir(file))
        await writable(path.join(file, name));
  }
  try {
    await writable(directory);
  } catch (error) {
    if ((error as Error & { code?: string }).code !== "ENOENT") throw error;
  }
  await rm(directory, { recursive: true, force: true });
}
export function spawnWorker(
  policy: WorkerPolicy,
  uid: number | undefined,
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  limits: CodeLimits,
  options: SpawnOptions,
): ChildProcess {
  assertWorkerPolicy(policy);
  if (!policy.development && uid === undefined)
    throw new RuntimeError(
      503,
      "CODE_ISOLATION_UNAVAILABLE",
      "Production worker UID is required",
    );
  // Bootstrap must ignore user libraries/sitecustomize until after dropping UID.
  const child = spawn(
    policy.python,
    [
      "-I",
      "-S",
      fileURLToPath(new URL("./worker-launch.py", import.meta.url)),
      command,
      ...args,
    ],
    {
      ...options,
      detached: process.platform !== "win32",
      ...(process.platform === "win32" && Array.isArray(options.stdio)
        ? {
            stdio: options.stdio.map((value, index) =>
              index === 3 ? "ignore" : value,
            ),
          }
        : {}),
      env: {
        ...env,
        RUNTIME_PARENT_PID: String(process.pid),
        RUNTIME_LIFETIME_FD: process.platform === "win32" ? "" : "4",
        RUNTIME_WORKER_UID: uid?.toString() ?? "",
        RUNTIME_WORKER_LIMITS: JSON.stringify(limits),
      },
    },
  );
  if (uid !== undefined) workerUids.set(child, uid);
  return child;
}
export const skillLimits = () =>
  codeLimitsSchema.parse({
    memoryBytes: 16 * 1024 ** 3,
    wallTimeMs: 600000,
    cpuSeconds: 600,
  });
export function signalWorker(
  child: ChildProcess,
  signal: "SIGTERM" | "SIGKILL",
) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    }).unref();
  } else {
    const uid = workerUids.get(child);
    if (uid !== undefined) signalUid(uid, signal);
    try {
      process.kill(-child.pid, signal);
    } catch (e) {
      if ((e as Error & { code?: string }).code !== "ESRCH") throw e;
    }
  }
}

export function signalUid(uid: number, signal: "SIGTERM" | "SIGKILL") {
  if (process.platform !== "linux" || uid < 20000)
    throw new Error("Invalid isolated worker UID");
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      if (
        Number(
          readFileSync(`/proc/${pid}/status`, "utf8").match(
            /^Uid:\s+(\d+)/m,
          )?.[1],
        ) === uid
      )
        process.kill(Number(pid), signal);
    } catch (error) {
      if (
        !["ESRCH", "ENOENT"].includes(
          (error as Error & { code?: string }).code ?? "",
        )
      )
        throw error;
    }
  }
}
