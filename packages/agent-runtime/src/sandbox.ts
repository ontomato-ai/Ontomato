import { chmod, chown, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { AgentTool } from "./core/pi/types";
import { RuntimeStore, digest, type Scope } from "./store";
import {
  assertWorkerPolicy,
  allocateUid,
  workerAssets,
  spawnWorker,
  signalWorker,
  removeWorkerFiles,
  type WorkerPolicy,
} from "./worker";
import type { InstalledSkill } from "./skills";

export class SessionSandbox {
  readonly workspace: string;
  private child?: ChildProcess;
  private closed?: Promise<void>;
  constructor(
    private store: RuntimeStore,
    private root: string,
    private policy: WorkerPolicy,
    private scope: Scope,
    readonly sessionId: string,
  ) {
    this.workspace = path.join(
      root,
      "sessions",
      digest([scope, sessionId]),
      "workspace",
    );
  }
  async prepare(skills: InstalledSkill[]) {
    assertWorkerPolicy(this.policy);
    const uid = await this.store.transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT worker_uid FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE`,
          [this.scope.hostId, this.scope.domainId, this.sessionId],
        )
      ).rows[0];
      if (!row) throw new Error("Session not found");
      if (row.worker_uid !== null) {
        await lstat(this.workspace);
        return Number(row.worker_uid);
      }
      const assigned = this.policy.development
        ? 0
        : await allocateUid(this.policy.uidStatePath!);
      // Allocation is monotonic; an interrupted initialization may burn a UID.
      await mkdir(this.workspace, { recursive: true, mode: 0o700 });
      await c.query(
        `UPDATE ${this.store.table("sessions")} SET worker_uid=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [this.scope.hostId, this.scope.domainId, this.sessionId, assigned],
      );
      return assigned;
    });
    for (const dir of [
      this.root,
      path.join(this.root, "sessions"),
      path.dirname(this.workspace),
    ])
      await chmod(dir, 0o711);
    if (!this.policy.development) await chown(this.workspace, 0, uid);
    await chmod(this.workspace, 0o1770);
    for (const name of ["work", "outputs", "home", "tmp"]) {
      const dir = path.join(this.workspace, name);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (!this.policy.development) await chown(dir, uid, uid);
    }
    const installed = path.join(this.workspace, "skills");
    await removeWorkerFiles(installed);
    await mkdir(installed, { mode: 0o750 });
    if (!this.policy.development) await chown(installed, 0, uid);
    for (const skill of skills)
      await workerAssets(
        this.policy,
        this.policy.development ? undefined : uid,
        skill.directory,
        path.join(installed, skill.skill.name),
      );
    await chmod(installed, 0o550);
    return this.policy.development ? undefined : uid;
  }
  async start(
    uid: number | undefined,
    runId: string,
    correlationId: string,
    request: RuntimeStartRunRequest,
    skills: InstalledSkill[],
  ): Promise<AgentTool[]> {
    const libraries = skills.map((s) =>
      path.join(this.workspace, "skills", s.skill.name, "python"),
    );
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      LANG: "C.UTF-8",
      HOME: path.join(this.workspace, "home"),
      TMPDIR: path.join(this.workspace, "tmp"),
      PYTHONPATH: libraries.join(path.delimiter),
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      ...request.environment.values,
      ...request.environment.secrets,
      ONTOMATO_SESSION_ID: this.sessionId,
      ONTOMATO_RUN_ID: runId,
      ONTOMATO_CORRELATION_ID: correlationId,
      ONTOMATO_LANGUAGE: request.language,
      ONTOMATO_WORKSPACE: this.workspace,
      ONTOMATO_OUTPUT_DIR: path.join(this.workspace, "outputs"),
    };
    const child = (this.child = spawnWorker(
      this.policy,
      uid,
      process.execPath,
      [fileURLToPath(new URL("./tool-worker.mjs", import.meta.url))],
      env,
      request.definition.sandbox.limits,
      { cwd: this.workspace, stdio: ["ignore", "pipe", "pipe", "ipc", "pipe"] },
    ));
    let diagnostic = "";
    child.stderr?.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-8192);
    });
    child.stdout?.resume();
    this.closed = new Promise((resolve) =>
      child.once("close", () => resolve()),
    );
    const descriptions = await new Promise<Array<Omit<AgentTool, "execute">>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          signalWorker(child, "SIGKILL");
          reject(new Error("Tool worker startup timed out"));
        }, 30000);
        const ready = (m: any) => {
          if (m.type === "ready") {
            clearTimeout(timer);
            child.off("message", ready);
            resolve(m.tools);
          }
        };
        child.on("message", ready);
        child.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Tool worker exited during startup: ${diagnostic}`));
        });
      },
    );
    return descriptions.map((tool) => ({
      ...tool,
      execute: (id, args, signal, onUpdate) =>
        new Promise((resolve, reject) => {
          const end = (error?: Error, value?: any) => {
            clearTimeout(timer);
            child.off("message", receive);
            child.off("exit", exit);
            signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve(value);
          };
          const receive = (m: any) => {
            if (m.id !== id) return;
            if (m.type === "update") onUpdate?.(m.result);
            else if (m.type === "result") end(undefined, m.result);
            else if (m.type === "error") end(new Error(m.message));
          };
          const exit = () =>
            end(new Error("Tool worker stopped before returning a result"));
          const abort = () => {
            child.send({ type: "cancel" }, () => {});
            signalWorker(child, "SIGTERM");
          };
          const timer = setTimeout(() => {
            signalWorker(child, "SIGKILL");
            end(new Error("Tool execution wall time limit exceeded"));
          }, request.definition.sandbox.limits.wallTimeMs);
          child.on("message", receive);
          child.once("exit", exit);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) {
            abort();
            return;
          }
          child.send(
            { type: "execute", id, name: tool.name, arguments: args },
            (e) => {
              if (e) end(e);
            },
          );
        }),
    }));
  }
  async stop() {
    if (!this.child) return;
    signalWorker(this.child, "SIGKILL");
    await this.closed;
    this.child = undefined;
  }
  async remove() {
    await this.stop();
    await removeWorkerFiles(path.dirname(this.workspace));
  }
}
