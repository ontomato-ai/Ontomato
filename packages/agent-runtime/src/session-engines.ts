import { randomBytes, timingSafeEqual } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RuntimeAgentDefinition, RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import { isDirectUserRun } from "@ontomato/contracts/agent-visibility";
import type { HarnessOpenRequest, HarnessPlugin, HarnessSession } from "./adapters/contract";
import { HarnessRegistry } from "./adapters/registry";
import { RuntimeError } from "./errors";
import type { ModelGatewayClient } from "./gateway-client";
import { litellmEntry, type ModelLease, type ResolvedChatModel } from "./model";
import { canonical, type RuntimeStore, type Scope } from "./store";
import { sessionSandboxDirectory, type OpenSessionSandbox } from "./sandbox";
import { businessCallbackEnvironment } from "./business-callback";
import { openSkillCallback } from "./skill-callback";
import { removeWorkerFiles } from "./worker";

export interface SessionEngineSandboxRequest {
  scope: Scope;
  sessionId: string;
  sessionDirectory: string;
  workspaceId: string | null;
  skills: readonly { name: string; directory: string }[];
  limits: RuntimeAgentDefinition["sandbox"]["limits"];
  gatewayUrl: string;
  callback: { host: string; port: number };
}

export type SessionEngineSandboxFactory = (request: SessionEngineSandboxRequest) => Promise<OpenSessionSandbox>;

type SessionLock = <T>(scope: Scope, id: string, operation: () => Promise<T>) => Promise<T>;

type EngineOpen = Pick<HarnessOpenRequest, "language" | "limits" | "signal" | "tools" | "engineTools"> & {
  plugin: HarnessPlugin;
  config(): Promise<ResolvedChatModel>;
  skills: SessionEngineSandboxRequest["skills"];
  previousContext(): Promise<RuntimeMessage[] | null>;
  prompt(directories: HarnessOpenRequest["directories"]): HarnessOpenRequest["prompt"];
};

interface LiveSession {
  scope: Scope;
  id: string;
  handle: HarnessSession;
  sandbox: OpenSessionSandbox;
  lease: ModelLease;
  exited(): boolean;
  credential: Buffer;
  runId?: string;
  idle?: ReturnType<typeof setTimeout>;
}

const idleMs = 10 * 60 * 1000;
const key = (scope: Scope, id: string) => canonical([scope.hostId, scope.domainId, id]);
const bashEnvironmentFile = "ontomato-bash-env";
const activeRunFile = "ontomato-run-id";
const bashEnvironment = [
  `_ontomato_run_id_file=\${BASH_ENV%/*}/${activeRunFile}`,
  'if [ -r "$_ontomato_run_id_file" ]; then',
  '  IFS= read -r ONTOMATO_RUN_ID < "$_ontomato_run_id_file" || ONTOMATO_RUN_ID=',
  '  export ONTOMATO_RUN_ID',
  'else',
  '  unset ONTOMATO_RUN_ID',
  'fi',
  'unset _ontomato_run_id_file',
].join("\n") + "\n";

/** Owns the native handle, process space and gateway lease for each admitted session. */
export class SessionEngines {
  private callback?: ReturnType<typeof openSkillCallback>;
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly store: RuntimeStore,
    private readonly root: string,
    private readonly gateway: ModelGatewayClient,
    private readonly registry: HarnessRegistry,
    private readonly sandboxFactory: SessionEngineSandboxFactory,
    private readonly locked: SessionLock,
    private readonly callbackDispatcher: Parameters<typeof openSkillCallback>[0],
    private readonly onCloseError: (error: unknown) => void,
  ) {}

  plugin(id: string) {
    return this.registry.get(id);
  }

  needsOpen(scope: Scope, id: string) {
    const entry = this.live.get(key(scope, id));
    return !entry || entry.exited();
  }

  admitted(scope: Scope, id: string) {
    const entry = this.live.get(key(scope, id));
    clearTimeout(entry?.idle);
    if (entry) entry.idle = undefined;
  }

  async open(scope: Scope, id: string, request: EngineOpen) {
    const sessionKey = key(scope, id);
    const existing = this.live.get(sessionKey);
    if (existing && !existing.exited()) return existing;
    if (existing) await this.release(scope, id);

    const config = await request.config();
    const { workspaceId } = await this.store.session(scope, id);
    const lease = await this.gateway.lease({ [config.name]: litellmEntry(config) });
    let sandbox: OpenSessionSandbox | undefined;
    let handle: HarnessSession | undefined;
    try {
      request.signal.throwIfAborted();
      this.callback ??= openSkillCallback(this.callbackDispatcher);
      const { endpoint: callback } = await this.callback;
      sandbox = await this.sandboxFactory({
        scope, sessionId: id, sessionDirectory: sessionSandboxDirectory(this.root, scope, id), workspaceId: workspaceId ?? null,
        skills: request.skills, limits: request.limits, gatewayUrl: lease.url, callback,
      });
      const processSpace = sandbox;
      const engineRef = await this.locked(scope, id, async () => {
        const { engineRef } = await this.store.sessionEngine(scope, id);
        if (engineRef === null) {
          for (const name of await readdir(processSpace.hostState))
            await removeWorkerFiles(path.join(processSpace.hostState, name));
        }
        return engineRef;
      });
      let exited = false;
      const token = randomBytes(32).toString("base64url");
      const credential = Buffer.from(token);
      const { directories } = processSpace;
      writeFileSync(path.join(processSpace.hostState, bashEnvironmentFile), bashEnvironment, { mode: 0o644 });
      rmSync(path.join(processSpace.hostState, activeRunFile), { force: true });
      const callbackUrl = new URL(
        `/v1/channel/hosts/${encodeURIComponent(scope.hostId)}/domains/${encodeURIComponent(scope.domainId)}/sessions/${encodeURIComponent(id)}`,
        processSpace.callbackBaseUrl,
      ).href;
      handle = await request.plugin.open({
        sessionId: id,
        domainId: scope.domainId,
        engineRef,
        previousContext: engineRef === null ? await request.previousContext() : null,
        sandbox: {
          spawn(command, args, env) {
            const child = processSpace.spawn(command, args, {
              ...env,
              BASH_ENV: path.posix.join(directories.state, bashEnvironmentFile),
              ONTOMATO_SKILL_SCENARIO: "platform",
              ONTOMATO_SESSION_ID: id,
              ONTOMATO_LANGUAGE: request.language,
              ONTOMATO_WORKSPACE: directories.workspace,
              ONTOMATO_SOURCE_DIR: path.posix.join(directories.workspace, "work"),
              ONTOMATO_OUTPUT_DIR: path.posix.join(directories.workspace, "outputs"),
              PYTHONPATH: directories.skills.map(skill => path.posix.join(skill.directory, "python")).join(":"),
              ONTOMATO_ASSISTANT_SESSION_ID: id,
              ONTOMATO_AGENT_COMMAND_URL: callbackUrl + "/commands",
              ...businessCallbackEnvironment(callbackUrl, token),
              ONTOMATO_AGENT_CALLBACK: token,
            });
            const markExited = () => { exited = true; };
            void child.exited.then(markExited, markExited);
            return child;
          },
        },
        directories: sandbox.directories,
        model: {
          baseUrl: sandbox.gatewayBaseUrl, token: lease.token,
          model: config.name, contextWindow: config.contextWindow,
          maxOutputTokens: config.maxOutputTokens ?? null,
        },
        prompt: request.prompt(sandbox.directories),
        tools: request.tools,
        engineTools: request.engineTools,
        limits: request.limits,
        language: request.language,
        signal: request.signal,
      });
      // The caller can submit the first prompt only after its native reference is committed.
      // Without that reference, no prompt used the native files and the next open can rebuild them.
      if (engineRef === null) await this.store.saveEngineRef(scope, id, handle.engineRef);
      const entry = { scope, id, handle, sandbox, lease, credential, exited: () => exited };
      this.live.set(sessionKey, entry);
      return entry;
    } catch (error) {
      await this.closeResources(lease, sandbox, handle);
      throw error;
    }
  }

  beginRun(scope: Scope, id: string, runId: string) {
    const entry = this.live.get(key(scope, id))!;
    entry.runId = runId;
    const directory = entry.sandbox.hostState;
    const temporary = path.join(directory, `.${activeRunFile}.${process.pid}`);
    writeFileSync(temporary, runId + "\n", { mode: 0o644 });
    renameSync(temporary, path.join(directory, activeRunFile));
  }

  endRun(scope: Scope, id: string) {
    const entry = this.live.get(key(scope, id));
    if (!entry) return;
    entry.runId = undefined;
    rmSync(path.join(entry.sandbox.hostState, activeRunFile), { force: true });
  }

  callbackRun(scope: Scope, id: string, credential: string | undefined) {
    const entry = this.live.get(key(scope, id));
    const supplied = Buffer.from(credential ?? "");
    if (!entry || supplied.length !== entry.credential.length || !timingSafeEqual(entry.credential, supplied))
      throw new RuntimeError(401, "UNAUTHENTICATED", "Invalid session callback credential");
    if (!entry.runId)
      throw new RuntimeError(409, "RUN_CLOSED", "No active run accepts skill commands");
    return entry.runId;
  }

  async settled(scope: Scope, run: Pick<RuntimeRun, "sessionId" | "channel">, hasQueuedRun: boolean) {
    const { sessionId: id, channel } = run;
    const entry = this.live.get(key(scope, id));
    if (!entry) return;
    if (!channel || !isDirectUserRun(channel, id)) {
      // Delegated results release through the delivery notification, after the parent can read the result.
      if (!channel?.requestedBy && !hasQueuedRun) await this.release(scope, id).catch(this.onCloseError);
      return;
    }
    const timer = setTimeout(() => {
      void this.locked(scope, id, async () => {
        if (entry.idle === timer) await this.release(scope, id);
      }).catch(this.onCloseError);
    }, idleMs);
    entry.idle = timer.unref();
  }

  delivered(scope: Scope, id: string, runId: string, hasQueuedRun: () => Promise<boolean>) {
    return this.locked(scope, id, async () => {
      if (!this.live.has(key(scope, id))) return;
      const { activeRunId, latestRunId } = await this.store.session(scope, id);
      if (!activeRunId && latestRunId === runId && !(await hasQueuedRun())) await this.release(scope, id);
    }).catch(this.onCloseError);
  }

  async release(scope: Scope, id: string) {
    const sessionKey = key(scope, id);
    const entry = this.live.get(sessionKey);
    if (!entry) return;
    clearTimeout(entry.idle);
    entry.idle = undefined;
    this.live.delete(sessionKey);
    await this.closeResources(entry.lease, entry.sandbox, entry.handle);
  }

  async remove(scope: Scope, id: string) {
    await this.store.deleteSession(scope, id, () => this.release(scope, id));
    await removeWorkerFiles(sessionSandboxDirectory(this.root, scope, id));
  }

  async close() {
    const outcomes = await Promise.allSettled([...this.live.values()].map(({ scope, id }) => this.release(scope, id)));
    for (const result of outcomes) {
      if (result.status === "rejected") this.onCloseError(result.reason);
    }
    if (this.callback) {
      const callback = await this.callback.catch(() => undefined);
      await callback?.close();
    }
  }

  private async closeResources(lease: ModelLease, sandbox?: OpenSessionSandbox, handle?: HarnessSession) {
    try {
      await handle?.close();
    } finally {
      try {
        await sandbox?.stop();
      } finally {
        await this.gateway.release(lease);
      }
    }
  }
}
