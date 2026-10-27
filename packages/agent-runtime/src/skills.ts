import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Compile } from "typebox/compile";
import type { TSchema } from "typebox";
import {
  RUNTIME_SKILL_ENV,
  runtimeRegisterSkillRequestSchema,
  runtimeSkillManifestSchema,
  runtimeToolSkillOutputSchema,
  runtimeContextSkillOutputSchema,
  type RuntimeSkillRef,
  type RuntimeSkillInput,
  type RuntimeSkillOutput,
} from "@ontomato/contracts/agent-runtime-skills";
import type {
  RuntimeStartRunRequest,
  RuntimeRegisteredSkill,
} from "@ontomato/contracts/agent-runtime";
import { RuntimeStore, canonical, digest, type Scope } from "./store";
import { RuntimeError } from "./errors";
import {
  workerIdentity,
  workerAssets,
  removeWorkerFiles,
  spawnWorker,
  skillLimits,
  signalWorker,
  type WorkerPolicy,
} from "./worker";

export interface RuntimeHost {
  id: string;
  token: string;
  providers: string[];
  publishProviders?: string[];
  domainSkills?: boolean;
}
export type InstalledSkill = RuntimeRegisteredSkill & {
  directory: string;
  instructions: string;
};
export class SkillRegistry {
  constructor(
    private store: RuntimeStore,
    private root: string,
  ) {}
  private authorize(
    host: RuntimeHost,
    domainId: string | undefined,
    ref: RuntimeSkillRef,
    publishing = false,
  ) {
    if (ref.namespace.kind === "provider") {
      if (
        !(publishing ? (host.publishProviders ?? []) : host.providers).includes(
          ref.namespace.provider,
        )
      )
        throw new RuntimeError(
          403,
          "FORBIDDEN",
          "Skill namespace is not authorized",
        );
    } else if (
      !host.domainSkills ||
      !domainId ||
      ref.namespace.domainId !== domainId
    )
      throw new RuntimeError(
        403,
        "FORBIDDEN",
        "Skill domain is not authorized",
      );
  }
  async register(
    host: RuntimeHost,
    domainId: string | undefined,
    body: unknown,
  ): Promise<RuntimeRegisteredSkill> {
    const pkg = runtimeRegisterSkillRequestSchema.parse(body);
    this.authorize(host, domainId, pkg.skill, true);
    const markdown = pkg.files.find((f) => f.path === "SKILL.md")!.content;
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const front = match ? parseYaml(match[1]!) : undefined;
    if (
      front?.name !== pkg.skill.name ||
      typeof front.description !== "string" ||
      !front.description.trim() ||
      front.metadata?.["ontomato-runtime-manifest"] !== "runtime.json"
    )
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "SKILL.md requires matching name, description and runtime manifest metadata",
      );
    const manifest = runtimeSkillManifestSchema.parse(
      JSON.parse(pkg.files.find((f) => f.path === "runtime.json")!.content),
    );
    if (manifest.version !== pkg.skill.version)
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "Skill version does not match its manifest",
      );
    const entries = [
      ...manifest.tools.map((t) => t.entry),
      ...(manifest.contextEntry ? [manifest.contextEntry] : []),
    ];
    if (
      entries.some((entry) => !pkg.files.some((f) => f.path === entry)) ||
      new Set(manifest.tools.map((t) => t.name)).size !== manifest.tools.length
    )
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "Skill entries must exist and tool names must be unique",
      );
    for (const tool of manifest.tools) {
      Compile(tool.inputSchema as TSchema);
      if (tool.outputSchema) Compile(tool.outputSchema as TSchema);
    }
    pkg.files.sort((a, b) => a.path.localeCompare(b.path));
    const sha = digest(pkg.files);
    await this.store.transaction(async (c) => {
      const key = canonical(pkg.skill);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const old = (
        await c.query(
          `SELECT * FROM ${this.store.table("skill_versions")} WHERE identity=$1`,
          [key],
        )
      ).rows[0];
      if (old && old.publisher !== host.id)
        throw new RuntimeError(
          403,
          "FORBIDDEN",
          "Only the skill publisher may register its version",
        );
      if (old && old.digest !== sha)
        throw new RuntimeError(
          409,
          "SKILL_VERSION_CONFLICT",
          "A published skill version cannot be overwritten",
        );
      if (!old)
        await c.query(
          `INSERT INTO ${this.store.table("skill_versions")} VALUES($1,$2,$3,$4,$5)`,
          [key, host.id, sha, pkg, manifest],
        );
    });
    return { skill: pkg.skill, digest: sha, manifest };
  }
  async resolve(
    host: RuntimeHost,
    domainId: string,
    ref: RuntimeSkillRef,
  ): Promise<InstalledSkill> {
    this.authorize(host, domainId, ref);
    const row = (
      await this.store.pool.query(
        `SELECT * FROM ${this.store.table("skill_versions")} WHERE identity=$1`,
        [canonical(ref)],
      )
    ).rows[0];
    if (!row)
      throw new RuntimeError(
        422,
        "SKILL_NOT_FOUND",
        "Skill version is not registered",
      );
    const pkg = runtimeRegisterSkillRequestSchema.parse(row.package);
    const directory = path.join(this.root, row.digest);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    // Atomic directory publication keeps an executing version immutable during product registration.
    try {
      await readFile(path.join(directory, "runtime.json"));
    } catch {
      const temporary = await mkdtemp(path.join(this.root, ".install-"));
      try {
        for (const file of pkg.files) {
          const destination = path.join(temporary, file.path);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, file.content, { mode: 0o400 });
        }
        try {
          await chmod(temporary, 0o700);
          await rename(temporary, directory);
        } catch (error) {
          if (
            (error as { code?: string }).code !== "EEXIST" &&
            (error as { code?: string }).code !== "ENOTEMPTY"
          )
            throw error;
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    await chmod(directory, 0o700);
    for (const file of pkg.files)
      await chmod(path.join(directory, file.path), 0o400);
    const markdown = pkg.files.find((f) => f.path === "SKILL.md")!.content;
    return {
      skill: ref,
      digest: row.digest,
      manifest: runtimeSkillManifestSchema.parse(row.manifest),
      directory,
      instructions: markdown
        .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
        .trim(),
    };
  }
}

/** One invocation, no retry. A disconnected runtime also kills this invocation's process tree. */
export async function executeSkill(options: {
  skill: InstalledSkill;
  input: RuntimeSkillInput;
  scope: Scope;
  sessionId: string;
  runId: string;
  toolCallId?: string;
  correlationId: string;
  request: RuntimeStartRunRequest;
  workspace: string;
  policy: WorkerPolicy;
  assetRoot: string;
  signal: AbortSignal;
  progress?: (value: Extract<RuntimeSkillOutput, { type: "progress" }>) => void;
}): Promise<Exclude<RuntimeSkillOutput, { type: "progress" }>> {
  const { skill, input, request, signal } = options;
  signal.throwIfAborted();
  const binding = request.privateContext.skillBindings.find(
    (b) => canonical(b.skill) === canonical(skill.skill),
  );
  if (!binding) throw new Error("Skill private binding is missing");
  const tool =
    input.kind === "tool"
      ? skill.manifest.tools.find((t) => t.name === input.toolName)
      : undefined;
  const entry =
    input.kind === "context" ? skill.manifest.contextEntry : tool?.entry;
  if (!entry) throw new Error("Skill entry is not declared");
  await mkdir(options.workspace, { recursive: true, mode: 0o700 });
  const env: Record<string, string | undefined> = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    [RUNTIME_SKILL_ENV.sessionId]: options.sessionId,
    [RUNTIME_SKILL_ENV.runId]: options.runId,
    [RUNTIME_SKILL_ENV.invocationId]: randomUUID(),
    [RUNTIME_SKILL_ENV.toolCallId]: options.toolCallId ?? "",
    [RUNTIME_SKILL_ENV.domainId]: options.scope.domainId,
    [RUNTIME_SKILL_ENV.correlationId]: options.correlationId,
    [RUNTIME_SKILL_ENV.language]: request.language,
    [RUNTIME_SKILL_ENV.targetUrl]: binding.targetUrl,
    [RUNTIME_SKILL_ENV.credential]: JSON.stringify(binding.credential),
    [RUNTIME_SKILL_ENV.context]: JSON.stringify(binding.context),
    [RUNTIME_SKILL_ENV.workspace]: options.workspace,
  });
  const identity = await workerIdentity(options.policy, options.workspace);
  const assets = path.join(options.assetRoot, randomUUID());
  try {
    await workerAssets(options.policy, identity.uid, skill.directory, assets);
  } catch (error) {
    await identity.release();
    await removeWorkerFiles(assets);
    throw error;
  }
  return new Promise<Exclude<RuntimeSkillOutput, { type: "progress" }>>(
    (resolve, reject) => {
      const child = spawnWorker(
        options.policy,
        identity.uid,
        process.execPath,
        [
          "--import",
          fileURLToPath(new URL("./skill-lifetime.mjs", import.meta.url)),
          path.join(assets, entry),
        ],
        env,
        skillLimits(),
        {
          cwd: options.workspace,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe", "ipc", "pipe"],
        },
      );
      const deadline = setTimeout(
        () => fail("Skill execution timed out"),
        skillLimits().wallTimeMs,
      );
      let buffer = "";
      let outputBytes = 0;
      let terminal:
        Exclude<RuntimeSkillOutput, { type: "progress" }> | undefined;
      let failure: Error | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        signalWorker(child, "SIGTERM");
        timer ??= setTimeout(() => signalWorker(child, "SIGKILL"), 300);
      };
      const fail = (message: string) => {
        failure ??= new Error(message);
        terminate();
      };
      const onAbort = () => {
        failure ??= new Error("Skill invocation cancelled");
        terminate();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > skillLimits().outputBytes)
          return fail("Skill output exceeds the transport byte limit");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            if (terminal) throw new Error("Output after terminal record");
            const output = (
              input.kind === "tool"
                ? runtimeToolSkillOutputSchema
                : runtimeContextSkillOutputSchema
            ).parse(JSON.parse(line));
            const credential = binding.credential;
            if (
              credential.kind !== "none" &&
              JSON.stringify(output).includes(credential.value)
            )
              throw new Error("Private credential in skill output");
            if (output.type === "progress") options.progress?.(output);
            else terminal = output;
          } catch {
            fail("Invalid or unsafe skill process output");
          }
        }
      });
      // Stderr can contain library headers, so it is drained without entering model or service logs.
      child.stderr!.resume();
      child.on("error", () => fail("Skill process could not start"));
      child.on("exit", () => {
        signalWorker(child, "SIGKILL");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        clearTimeout(deadline);
        signal.removeEventListener("abort", onAbort);
        if (failure) return reject(failure);
        if (
          buffer.trim() ||
          !terminal ||
          (terminal.type === "error" ? code === 0 : code !== 0)
        )
          return reject(
            new Error(
              "Skill process did not complete its protocol; external outcome is unknown",
            ),
          );
        if (
          terminal.type === "result" &&
          tool?.outputSchema &&
          !Compile(tool.outputSchema as TSchema).Check(terminal.data)
        )
          return reject(
            new Error("Skill result does not match its output schema"),
          );
        resolve(terminal);
      });
      child.stdin!.on("error", () => {});
      child.stdin!.end(`${JSON.stringify(input)}\n`);
      if (signal.aborted) onAbort();
    },
  ).finally(async () => {
    await identity.release();
    await removeWorkerFiles(assets);
  });
}
