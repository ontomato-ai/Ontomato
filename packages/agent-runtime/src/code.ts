import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import type { TSchema } from "typebox";
import {
  codeExecutionRequestSchema,
  type CodeExecution,
  type CodeExecutionRequest,
  type PythonBinding,
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
import type { AgentTool } from "./core/pi/types";

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
  ) {}
  async initialize() {
    await removeWorkerFiles(this.root);
    await mkdir(this.root, { recursive: true, mode: 0o711 });
    await chmod(this.root, 0o711);
    await this.store.pool
      .query(`CREATE TABLE IF NOT EXISTS ${this.store.table("code_executions")} (
      host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL,
      fingerprint text NOT NULL, execution jsonb NOT NULL, outputs jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY(host_id,domain_id,id))`);
    await this.store.pool
      .query(`UPDATE ${this.store.table("code_executions")} SET execution =
      execution || jsonb_build_object('status','interrupted','finishedAt',now()::text,
      'error',jsonb_build_object('code','EXECUTION_INTERRUPTED','message','Runtime restarted; execution was not replayed'))
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
    if (!result.rowCount || typeof result.rows[0].outputs[name] !== "string")
      throw missing();
    return result.rows[0].outputs[name];
  }
  async start(
    host: RuntimeHost,
    scope: Scope,
    id: string,
    correlationId: string,
    body: unknown,
    runId: string | null = null,
  ) {
    const request = codeExecutionRequestSchema.parse(body);
    const { credential: _credential, ...binding } = request.binding;
    const fingerprint = digest({ ...request, binding, runId });
    const execution: CodeExecution = {
      id,
      runId,
      entry: request.entry,
      status: "running",
      source: request.files.find((f) => f.path === request.entry)!.content,
      sourceSha256: sourceHash(
        request.files.find((f) => f.path === request.entry)!.content,
      ),
      createdAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      outputs: [],
      error: null,
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
        return {
          execution: old.rows[0].execution as CodeExecution,
          replayed: true,
        };
      }
      assertWorkerPolicy(this.policy);
      await c.query(
        `INSERT INTO ${this.store.table("code_executions")} (host_id,domain_id,id,fingerprint,execution) VALUES($1,$2,$3,$4,$5)`,
        [scope.hostId, scope.domainId, id, fingerprint, execution],
      );
      return { execution, replayed: false };
    });
    if (!accepted.replayed) {
      const controller = new AbortController();
      const active = { controller, done: Promise.resolve() };
      this.active.set(scopeKey(scope, id), active);
      active.done = this.execute(
        host,
        scope,
        execution,
        request,
        correlationId,
        controller.signal,
      ).finally(() => this.active.delete(scopeKey(scope, id)));
      void active.done.catch(() =>
        process.stderr.write("Code execution persistence failed\n"),
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
      for (const lib of request.binding.libraries) {
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
        ONTOMATO_TARGET_URL: request.binding.targetUrl ?? "",
        ONTOMATO_CREDENTIAL_JSON: JSON.stringify(request.binding.credential),
        ONTOMATO_CONTEXT_JSON: JSON.stringify(request.binding.context),
        ONTOMATO_CORRELATION_ID: correlationId,
        ONTOMATO_RUN_ID: execution.runId ?? execution.id,
        ONTOMATO_DOMAIN_ID: scope.domainId,
      };
      const child = spawnWorker(
        this.policy,
        identity.uid,
        this.policy.python,
        [request.entry, ...request.arguments],
        env,
        request.binding.limits,
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
      }, request.binding.limits.wallTimeMs);
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
          if (byteCount > request.binding.limits.outputBytes) {
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
          stat.size + byteCount > request.binding.limits.outputBytes
        )
          throw new Error("CODE_OUTPUT_LIMIT: output file exceeds limit");
        outputs[name] = await readFile(target, "utf8");
        byteCount += stat.size;
      }
      const credential = request.binding.credential;
      if (
        credential.kind !== "none" &&
        Object.values(outputs).some((v) => v.includes(credential.value))
      )
        throw new Error("CODE_SECRET_OUTPUT: private credential in output");
      execution.status = "completed";
      execution.outputs = Object.keys(outputs);
    } catch (error) {
      execution.status = signal.aborted ? "cancelled" : "failed";
      const message =
        error instanceof Error ? error.message : "Code execution failed";
      execution.error = {
        code: message.match(/^CODE_[A-Z_]+/)?.[0] ?? "CODE_EXECUTION_FAILED",
        message,
      };
      if (execution.error.code === "CODE_SECRET_OUTPUT")
        for (const name of Object.keys(outputs)) delete outputs[name];
      execution.outputs = Object.keys(outputs);
    } finally {
      const cleanup = await Promise.allSettled([
        identity?.release(),
        removeWorkerFiles(executionAssets),
      ]);
      cleanup.push(
        ...(await Promise.allSettled([removeWorkerFiles(directory)])),
      );
      if (cleanup.some((result) => result.status === "rejected")) {
        execution.status = "failed";
        execution.error = {
          code: "CODE_CLEANUP_FAILED",
          message: "Execution workspace cleanup failed",
        };
      }
    }
    const secret = request.binding.credential;
    if (
      secret.kind !== "none" &&
      Object.values(outputs).some((value) => value.includes(secret.value))
    ) {
      for (const name of Object.keys(outputs)) delete outputs[name];
      execution.outputs = [];
      execution.status = "failed";
      execution.error = {
        code: "CODE_SECRET_OUTPUT",
        message: "Private credential in process output",
      };
    }
    execution.finishedAt = new Date().toISOString();
    await this.store.pool.query(
      `UPDATE ${this.store.table("code_executions")} SET execution=$4,outputs=$5 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [scope.hostId, scope.domainId, execution.id, execution, outputs],
    );
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
        `UPDATE ${this.store.table("code_executions")} SET execution=execution || jsonb_build_object('status','cancelled','finishedAt',now()::text,'error',jsonb_build_object('code','CODE_CANCELLED','message','Cancelled before execution')) WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND execution->>'status'='running'`,
        [scope.hostId, scope.domainId, id],
      );
    const active = this.active.get(scopeKey(scope, id));
    active?.controller.abort();
    await active?.done;
  }
  async listRun(scope: Scope, runId: string) {
    await this.store.run(scope, runId);
    const result = await this.store.pool.query(
      `SELECT execution FROM ${this.store.table("code_executions")} WHERE host_id=$1 AND domain_id=$2 AND execution->>'runId'=$3 ORDER BY execution->>'createdAt',id`,
      [scope.hostId, scope.domainId, runId],
    );
    return result.rows.map((row) => row.execution as CodeExecution);
  }
  async cancelRun(scope: Scope, runId: string) {
    const result = await this.store.pool.query(
      `SELECT id FROM ${this.store.table("code_executions")} WHERE host_id=$1 AND domain_id=$2 AND execution->>'runId'=$3 AND execution->>'status'='running'`,
      [scope.hostId, scope.domainId, runId],
    );
    await Promise.all(result.rows.map((r) => this.cancel(scope, r.id)));
  }
  tool(
    host: RuntimeHost,
    scope: Scope,
    runId: string,
    correlationId: string,
    workspace: string,
    binding: PythonBinding,
  ): AgentTool {
    return {
      name: "python_execute",
      label: "Execute Python",
      description:
        "Execute a workspace Python file. Returns an immutable execution receipt; no business completion is implied.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          arguments: { type: "array", items: { type: "string" } },
          outputPaths: { type: "array", items: { type: "string" } },
        },
        required: ["path"],
      } as TSchema,
      execute: async (_toolCallId, args, signal) => {
        const input = args as {
          path: string;
          arguments?: string[];
          outputPaths?: string[];
        };
        const id = randomUUID();
        await this.start(
          host,
          scope,
          id,
          correlationId,
          {
            language: "python",
            files: await workspaceFiles(workspace),
            entry: input.path,
            arguments: input.arguments ?? [],
            outputPaths: input.outputPaths ?? [],
            binding,
          },
          runId,
        );
        const abort = () => {
          void this.cancel(scope, id);
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        try {
          await this.active.get(scopeKey(scope, id))?.done;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
        const execution = await this.get(scope, id);
        const stdout = execution.outputs.includes("stdout")
          ? await this.output(scope, id, "stdout")
          : "";
        const stderr = execution.outputs.includes("stderr")
          ? await this.output(scope, id, "stderr")
          : "";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                executionId: id,
                sourceSha256: execution.sourceSha256,
                status: execution.status,
                error: execution.error,
                stdout: stdout.slice(0, 10000),
                stdoutChars: stdout.length,
                stderr,
              }),
            },
          ],
          details: { executionId: id },
          isError: execution.status !== "completed",
        };
      },
    };
  }
  async close() {
    for (const value of this.active.values()) value.controller.abort();
    await Promise.allSettled([...this.active.values()].map((v) => v.done));
  }
}
