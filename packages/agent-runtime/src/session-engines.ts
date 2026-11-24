import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { RuntimeAgentDefinition } from "@ontomato/contracts/agent-runtime";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
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

type EngineOpen = Pick<HarnessOpenRequest, "engineRef" | "language" | "limits" | "signal" | "tools" | "engineTools"> & {
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

const idleMs = 60 * 60 * 1000;
const key = (scope: Scope, id: string) => canonical([scope.hostId, scope.domainId, id]);

/** Owns the native handle, process space and gateway lease for each admitted session. */
export class SessionEngines {
  private callback?: ReturnType<typeof openSkillCallback>;
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly store: RuntimeStore,
    private readonly root: string,
    private readonly gateway: ModelGatewayClient,
    private readonly registry: HarnessRegistry,
    private readonly sandboxFactory: SessionEngineSandboxFactory | undefined,
    private readonly locked: SessionLock,
    private readonly callbackDispatcher: Parameters<typeof openSkillCallback>[0],
    private readonly onCloseError: (error: unknown) => void,
  ) {}

  plugin(id: string) {
    if (!this.sandboxFactory)
      throw new RuntimeError(503, "CODE_ISOLATION_UNAVAILABLE", "The session engine sandbox is not configured");
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
      sandbox = await this.sandboxFactory!({
        scope, sessionId: id, sessionDirectory: sessionSandboxDirectory(this.root, scope, id), workspaceId: workspaceId ?? null,
        skills: request.skills, limits: request.limits, gatewayUrl: lease.url, callback,
      });
      const processSpace = sandbox;
      let exited = false;
      const token = randomBytes(32).toString("base64url");
      const credential = Buffer.from(token);
      const { directories } = processSpace;
      const callbackUrl = new URL(
        `/v1/channel/hosts/${encodeURIComponent(scope.hostId)}/domains/${encodeURIComponent(scope.domainId)}/sessions/${encodeURIComponent(id)}`,
        processSpace.callbackBaseUrl,
      ).href;
      handle = await request.plugin.open({
        sessionId: id,
        domainId: scope.domainId,
        engineRef: request.engineRef,
        previousContext: request.engineRef === null ? await request.previousContext() : null,
        sandbox: {
          spawn(command, args, env) {
            const child = processSpace.spawn(command, args, {
              ...env,
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
      await this.store.saveEngineRef(scope, id, handle.engineRef);
      const entry = { scope, id, handle, sandbox, lease, credential, exited: () => exited };
      this.live.set(sessionKey, entry);
      return entry;
    } catch (error) {
      await this.closeResources(lease, sandbox, handle);
      throw error;
    }
  }

  beginRun(scope: Scope, id: string, runId: string) {
    this.live.get(key(scope, id))!.runId = runId;
  }

  endRun(scope: Scope, id: string) {
    const entry = this.live.get(key(scope, id));
    if (entry) entry.runId = undefined;
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

  idle(scope: Scope, id: string) {
    const entry = this.live.get(key(scope, id));
    if (!entry) return;
    const timer = setTimeout(() => {
      void this.locked(scope, id, async () => {
        if (entry.idle === timer) await this.release(scope, id);
      }).catch(this.onCloseError);
    }, idleMs);
    entry.idle = timer.unref();
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
    await this.release(scope, id);
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
