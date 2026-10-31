import { getServiceLogContext, withServiceLogContext, updateServiceLogContext } from "@ontomato/service-logging";
import { runtimeLogger, runtimeDiagnostic } from "./logging";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import {
  codeExecutionRequestSchema,
  type CodeExecution,
  type CodeExecutionRequest,
} from "@ontomato/contracts/agent-runtime-code";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeStore, canonical, digest, type Scope } from "./store";
import { RuntimeError, missing } from "./errors";
import { SkillRegistry, type RuntimeHost } from "./skills";
import {
  assertWorkerPolicy,
  spawnWorker,
  workerIdentity,
  workerAssets,
  removeWorkerFiles,
  signalWorker,
  type WorkerPolicy,
} from "./worker";
import { ArtifactFiles } from "./files";

export const sourceHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const scopeKey = (scope: Scope, id: string) =>
  canonical([scope.hostId, scope.domainId, id]);

export async function workspaceFiles(
  root: string,
  prefix = "",
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  for (const name of await readdir(path.join(root, prefix))) {
    if (name === "__pycache__") continue;
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(path.join(root, relative));
    if (stat.isSymbolicLink())
      throw new Error("Workspace symbolic links are not executable inputs");
    if (stat.isDirectory())
      files.push(...(await workspaceFiles(root, relative)));
    else if (stat.isFile())
      files.push({
        path: relative,
        content: await readFile(path.join(root, relative), "utf8"),
      });
    else throw new Error("Workspace contains a non-regular input");
  }
  return files;
}

/** Generic code execution facts; no dataset parsing or permission decisions. */
export class CodeExecutor {
  private active = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  constructor(
    private store: RuntimeStore,
    private registry: SkillRegistry,
    private root: string,
    readonly policy: WorkerPolicy,
    private files: ArtifactFiles,
  ) {}
  async initialize() {
    await removeWorkerFiles(this.root);
    await mkdir(this.root, { recursive: true, mode: 0o711 });
    await chmod(this.root, 0o711);
    await this.store.pool
      .query(`UPDATE ${this.store.table("code_executions")} SET execution =
      execution || jsonb_build_object('status','stopped','finishedAt',now()::text,
      'errorMessage','Runtime restarted; execution was not replayed')
      WHERE execution->>'status'='running'`);
  }
  async get(scope: Scope, id: string): Promise<CodeExecution> {
    const result = await this.store.pool.query(
      `SELECT execution FROM ${this.store.table("code_executions")}
      WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [scope.hostId, scope.domainId, id],
    );
    if (!result.rowCount) throw missing();
    return result.rows[0].execution;
  }
  async output(scope: Scope, id: string, name: string): Promise<string> {
    const result = await this.store.pool.query(
      `SELECT outputs FROM ${this.store.table("code_executions")}
      WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [scope.hostId, scope.domainId, id],
    );
    if (!result.rowCount || !result.rows[0].outputs[name]) throw missing();
    return (await this.files.read(result.rows[0].outputs[name])).toString(
      "utf8",
    );
  }
  async start(
    host: RuntimeHost,
    scope: Scope,
    id: string,
    correlationId: string,
    body: unknown,
  ) {
    const request = codeExecutionRequestSchema.parse(body);
    const logContext = { ...getServiceLogContext(), correlationId, runId: id, domainId: scope.domainId };
    const fingerprint = digest({
      ...request,
      environment: {
        values: request.environment.values,
        secretNames: Object.keys(request.environment.secrets).sort(),
      },
    });
    const execution: CodeExecution = {
      id,
      entry: request.entry,
      status: "running",
      sourceSha256: sourceHash(
        request.files.find((f) => f.path === request.entry)!.content,
      ),
      createdAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      outputs: [],
      errorMessage: null,
    };
    const accepted = await this.store.transaction(async (c) => {
      await this.store.admission(c, scope, id, "code", fingerprint, id);
      const old = await c.query(
        `SELECT * FROM ${this.store.table("code_executions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [scope.hostId, scope.domainId, id],
      );
      if (old.rowCount) {
        if (old.rows[0].fingerprint !== fingerprint)
          throw new RuntimeError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Execution input changed",
          );
        updateServiceLogContext(old.rows[0].log_context);
        return {
          execution: old.rows[0].execution as CodeExecution,
          replayed: true,
        };
      }
      assertWorkerPolicy(this.policy);
      await c.query(
        `INSERT INTO ${this.store.table("code_executions")} (host_id,domain_id,id,fingerprint,execution,log_context) VALUES($1,$2,$3,$4,$5,$6)`,
        [scope.hostId, scope.domainId, id, fingerprint, execution, logContext],
      );
      return { execution, replayed: false };
    });
    if (!accepted.replayed) {
      const controller = new AbortController();
      const active = { controller, done: Promise.resolve() };
      this.active.set(scopeKey(scope, id), active);
      updateServiceLogContext(logContext);
      active.done = withServiceLogContext(logContext, () => this.execute(
        host,
        scope,
        execution,
        request,
        correlationId,
        controller.signal,
      )).finally(() => this.active.delete(scopeKey(scope, id)));
      void active.done.catch(() =>
        withServiceLogContext(logContext, () => runtimeLogger.error("Code execution persistence failed")),
      );
    }
    return accepted;
  }
  private async execute(
    host: RuntimeHost,
    scope: Scope,
    execution: CodeExecution,
    request: CodeExecutionRequest,
    correlationId: string,
    signal: AbortSignal,
  ) {
    if ((await this.get(scope, execution.id)).status !== "running") return;
    const parent = path.join(this.root, digest(scope));
    const executionAssets = path.join(
      this.root,
      "libraries",
      digest(scope),
      execution.id,
    );
    runtimeLogger.info("code execution started");
    const directory = path.join(parent, execution.id);
    const outputs: Record<string, string> = {};
    let identity: Awaited<ReturnType<typeof workerIdentity>> | undefined;
    try {
      await mkdir(parent, { recursive: true, mode: 0o711 });
      await mkdir(directory, { mode: 0o700 });
      for (const file of request.files) {
        await mkdir(path.dirname(path.join(directory, file.path)), {
          recursive: true,
        });
        await writeFile(path.join(directory, file.path), file.content, {
          mode: 0o600,
        });
      }
      const libraries: string[] = [];
      identity = await workerIdentity(this.policy, directory);
      await mkdir(executionAssets, { recursive: true, mode: 0o711 });
      for (const lib of request.libraries) {
        const installed = await this.registry.resolve(
          host,
          scope.domainId,
          lib.skill,
        );
        const dest = path.join(executionAssets, String(libraries.length));
        await workerAssets(
          this.policy,
          identity.uid,
          path.join(installed.directory, lib.path),
          dest,
        );
        libraries.push(dest);
      }
      const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        LANG: "C.UTF-8",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
        PYTHONPATH: libraries.join(path.delimiter),
        HOME: directory,
        TMPDIR: directory,
        ...request.environment.values,
        ...request.environment.secrets,
        ONTOMATO_CORRELATION_ID: correlationId,
        ONTOMATO_RUN_ID: execution.id,
        ONTOMATO_LANGUAGE: request.locale,
        ONTOMATO_WORKSPACE: directory,
        ONTOMATO_OUTPUT_DIR: directory,
      };
      const child = spawnWorker(
        this.policy,
        identity.uid,
        this.policy.python,
        [request.entry, ...request.arguments],
        env,
        request.limits,
        { cwd: directory, stdio: ["ignore", "pipe", "pipe", "ignore", "pipe"] },
      );
      let byteCount = 0,
        failure: Error | undefined,
        killTimer: ReturnType<typeof setTimeout> | undefined;
      outputs.stdout = "";
      outputs.stderr = "";
      const stop = () => {
        signalWorker(child, "SIGTERM");
        killTimer ??= setTimeout(() => signalWorker(child, "SIGKILL"), 300);
      };
      const deadline = setTimeout(() => {
        failure = new Error("CODE_TIMEOUT: wall time limit exceeded");
        stop();
      }, request.limits.wallTimeMs);
      const abort = () => {
        failure = new Error("CODE_CANCELLED: execution cancelled");
        stop();
      };
      signal.addEventListener("abort", abort, { once: true });
      for (const [name, stream] of [
        ["stdout", child.stdout],
        ["stderr", child.stderr],
      ] as const) {
        stream!.setEncoding("utf8");
        stream!.on("data", (chunk: string) => {
          byteCount += Buffer.byteLength(chunk);
          if (byteCount > request.limits.outputBytes) {
            failure = new Error("CODE_OUTPUT_LIMIT: output exceeds limit");
            stop();
          } else outputs[name] += chunk;
        });
      }
      try {
        execution.exitCode = await new Promise<number | null>(
          (resolve, reject) => {
            child.once("error", reject);
            child.once("exit", () => signalWorker(child, "SIGKILL"));
            child.once("close", resolve);
            if (signal.aborted) abort();
          },
        );
      } finally {
        clearTimeout(deadline);
        clearTimeout(killTimer);
        signal.removeEventListener("abort", abort);
        signalWorker(child, "SIGKILL");
      }
      if (failure) throw failure;
      if (execution.exitCode !== 0)
        throw new Error(`CODE_EXIT: process exited with ${execution.exitCode}`);
      for (const name of request.outputPaths) {
        runtimeRelativePathSchema.parse(name);
        let target = directory;
        for (const part of name.split("/")) {
          target = path.join(target, part);
          if ((await lstat(target)).isSymbolicLink())
            throw new Error("CODE_OUTPUT_PATH: symbolic output");
        }
        const stat = await lstat(target);
        if (
          !stat.isFile() ||
          stat.size + byteCount > request.limits.outputBytes
        )
          throw new Error("CODE_OUTPUT_LIMIT: output file exceeds limit");
        outputs[name] = await readFile(target, "utf8");
        byteCount += stat.size;
      }
    } catch (error) {
      if (!signal.aborted) runtimeLogger.error("code execution failed", runtimeDiagnostic(error));
      execution.errorMessage = signal.aborted
        ? "Execution cancelled"
        : error instanceof Error
          ? error.message
          : "Code execution failed";
    } finally {
      const cleanup = await Promise.allSettled([
        identity?.release(),
        removeWorkerFiles(executionAssets),
      ]);
      cleanup.push(
        ...(await Promise.allSettled([removeWorkerFiles(directory)])),
      );
      if (cleanup.some((result) => result.status === "rejected")) {
        execution.errorMessage = "Execution workspace cleanup failed";
      }
    }
    await this.files.withLock(async () => {
      const snapshots: Record<
        string,
        import("@ontomato/contracts/agent-runtime-artifacts").RuntimeFileMetadata
      > = {};
      outputs.source = request.files.find(
        (f) => f.path === request.entry,
      )!.content;
      for (const [name, text] of Object.entries(outputs))
        snapshots[name] = await this.files.put(Buffer.from(text), name);
      execution.outputs = Object.entries(snapshots).map(([name, meta]) => ({
        name,
        ...meta,
      }));
      runtimeLogger.info(execution.errorMessage ? "code execution failed" : "code execution completed");
      execution.status = "stopped";
      execution.finishedAt = new Date().toISOString();
      await this.store.pool.query(
        `UPDATE ${this.store.table("code_executions")} SET execution=$4,outputs=$5 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [scope.hostId, scope.domainId, execution.id, execution, snapshots],
      );
    });
  }
  async cancel(scope: Scope, id: string) {
    await this.get(scope, id);
    const active = this.active.get(scopeKey(scope, id));
    active?.controller.abort();
    await active?.done;
    return this.get(scope, id);
  }
  /** Close a host's creation intent even if its admission response was lost. */
  async closeIntent(scope: Scope, id: string) {
    const admitted = await this.store.closeAdmission(scope, id, "code");
    if (admitted && !this.active.has(scopeKey(scope, id)))
      await this.store.pool.query(
        `UPDATE ${this.store.table("code_executions")} SET execution=execution || jsonb_build_object('status','stopped','finishedAt',now()::text,'errorMessage','Cancelled before execution') WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND execution->>'status'='running'`,
        [scope.hostId, scope.domainId, id],
      );
    const active = this.active.get(scopeKey(scope, id));
    active?.controller.abort();
    await active?.done;
  }
  async close() {
    for (const value of this.active.values()) value.controller.abort();
    await Promise.allSettled([...this.active.values()].map((v) => v.done));
  }
}
