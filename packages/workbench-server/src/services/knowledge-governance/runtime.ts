import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import {
  governanceSessionSchema,
  type GovernanceSession,
  type GovernanceStreamEvent,
} from "@ontomato/contracts/knowledge-governance";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import { renderPrompt } from "../../core/prompts/loader";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import { initializeSse } from "../../utils/sse";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { governanceStore, type GovernanceOwner } from "./store";
import type { GovernanceCredentials } from "./materials";
import { governanceSkillRef } from "./skill";
import { governanceChatMessages, governanceLiveSnapshot } from "./chat-view";

const failureMessage = (run: { errorMessage?: string | null }) =>
  run.errorMessage ||
  "The governance response could not finish. Saved work is retained; please retry.";
const governanceStatus = (
  run:
    Pick<RuntimeRunSnapshot["run"], "status" | "stopReason"> | null | undefined,
): GovernanceSession["status"] => {
  if (!run) return "idle";
  if (run.status === "running") return "running";
  switch (run.stopReason) {
    case "stop":
    case "length":
      return "idle";
    case "aborted":
      return "stopped";
    case "error":
      return "failed";
    default:
      return "stopped";
  }
};

export class GovernanceRuntime {
  async start(
    owner: GovernanceOwner,
    credentials: GovernanceCredentials,
    locale: string,
    message: string,
  ) {
    const record = await governanceStore.create(owner);
    return this.respond(record.id, owner, credentials, locale, message);
  }
  async respond(
    id: string,
    owner: GovernanceOwner,
    credentials: GovernanceCredentials,
    locale: string,
    message: string,
  ) {
    const record = await governanceStore.get(id, owner);
    if (!record.runtimeSessionId)
      throw new HttpError(
        409,
        "External work record has no runtime conversation",
      );
    if (!record.runtimeSessionId) return { success: true };
    const client = new RuntimeClient(owner.domainId),
      snapshot = await client.session(record.runtimeSessionId);
    if (snapshot.session.activeRunId)
      throw new HttpError(409, "Governance session is already running");
    if (record.writeRunId)
      await governanceStore.closeRun(id, owner, record.writeRunId);
    const runId = randomUUID();
    if (!record.runtimeSessionId)
      throw new HttpError(
        409,
        "External work record has no runtime conversation",
      );
    const expiresAt = new Date(Date.now() + getQueryTimeoutMs());
    await governanceStore.openRun(id, owner, runId, expiresAt, { message });
    try {
      await client.start(record.runtimeSessionId, runId, {
        language: locale,
        definition: {
          systemPrompt:
            renderPrompt("knowledge-governance.main.system", {}, locale) +
            "\n\n" +
            ARTIFACT_MARKDOWN_PROMPT,
          modelRole: "knowledgeGovernance",
          skills: [governanceSkillRef],
          sandbox: {
            limits: codeLimitsSchema.parse({
              memoryBytes: 16 * 1024 ** 3,
              wallTimeMs: getQueryTimeoutMs(),
              cpuSeconds: Math.ceil(getQueryTimeoutMs() / 1000),
            }),
          },
          externalMcp: [],
          compaction: {
            systemPrompt: renderPrompt(
              "knowledge-governance.compaction.system",
              {},
              locale,
            ),
            summarizePrompt: renderPrompt(
              "knowledge-governance.compaction.summarize.user",
              {},
              locale,
            ),
            updatePrompt: renderPrompt(
              "knowledge-governance.compaction.update.user",
              {},
              locale,
            ),
          },
        },
        input: { role: "user", content: message, timestamp: Date.now() },
        environment: {
          values: {
            ONTOMATO_WORKBENCH_URL: environment
              .agentRuntime()
              .callbackUrl.replace(/\/$/, ""),
            ONTOMATO_GOVERNANCE_ID: id,
          },
          secrets: {
            ONTOMATO_TK: callbackCredential({
              pathPrefix: `/api/knowledge-governance/${id}/runs/${runId}/`,
              runId,
              expiresAt: expiresAt.getTime(),
              token: credentials.token ?? "",
              apiKey: credentials.apiKey ?? "",
            }).value,
          },
        },
      });
    } catch (error) {
      await governanceStore.closeRun(
        id,
        owner,
        runId,
        "The governance request could not be admitted. Saved work is retained.",
      );
      throw error;
    }
    return this.get(id, owner);
  }
  async stop(id: string, owner: GovernanceOwner) {
    const record = await governanceStore.get(id, owner);
    if (record.writeRunId)
      await governanceStore.closeRun(id, owner, record.writeRunId);
    const client = new RuntimeClient(owner.domainId),
      snapshot = await client.session(record.runtimeSessionId!);
    if (snapshot.session.activeRunId)
      await client.cancel(snapshot.session.activeRunId);
    return { success: true };
  }
  async get(id: string, owner: GovernanceOwner): Promise<GovernanceSession> {
    let record = await governanceStore.get(id, owner);
    if (!record.runtimeSessionId)
      return governanceSessionSchema.parse({
        ...record,
        status: "stopped",
        activeTurnId: null,
        messages: [],
        error: null,
      });
    const snapshot = await new RuntimeClient(owner.domainId).session(
      record.runtimeSessionId,
    );
    const latest = snapshot.latestRun;
    const status = governanceStatus(latest?.run);
    if (latest && status !== "running") {
      await governanceStore.closeRun(
        id,
        owner,
        latest.run.id,
        status === "failed" ? failureMessage(latest.run) : undefined,
      );
      record = await governanceStore.get(id, owner);
    }
    return governanceSessionSchema.parse({
      ...record,
      status,
      activeTurnId: snapshot.session.activeRunId,
      messages: governanceChatMessages(
        snapshot.messages
          .filter((m) => m.runId !== snapshot.session.activeRunId)
          .map((m) => m.message),
        latest?.run.status !== "running" ? latest?.toolExecutions : [],
      ),
      error: status === "failed" ? failureMessage(latest!.run) : null,
    });
  }
  async list(owner: GovernanceOwner) {
    const records = (await governanceStore.list(owner)).filter(
      (r): r is typeof r & { runtimeSessionId: string } =>
        r.runtimeSessionId !== null,
    );
    if (!records.length) return [];
    const statuses = await new RuntimeClient(owner.domainId).sessionStatuses(
      records.map((record) => record.runtimeSessionId),
    );
    const byId = new Map(statuses.map((status) => [status.session.id, status]));
    return Promise.all(
      records.map(async (record) => {
        const status = byId.get(record.runtimeSessionId);
        if (!status)
          throw new Error(
            "Runtime status response is missing a requested session",
          );
        const latest = status.latestRun;
        if (latest && latest.status !== "running") {
          await governanceStore.closeRun(record.id, owner, latest.id);
          const current = await governanceStore.get(record.id, owner);
          record = { ...current, runtimeSessionId: record.runtimeSessionId };
        }
        return {
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          status: governanceStatus(latest),
        };
      }),
    );
  }
  /** Each browser connection begins with a runtime snapshot; a host restart loses no authority. */
  async stream(
    id: string,
    owner: GovernanceOwner,
    runId: string,
    res: Response,
  ) {
    const record = await governanceStore.get(id, owner),
      client = new RuntimeClient(owner.domainId);
    const runIdentity = {
      governanceSessionId: id,
      sessionId: record.id,
      runId,
    };
    let snapshot = await client.run(runId);
    if (snapshot.run.sessionId !== record.runtimeSessionId)
      throw new HttpError(404, "Governance run not found");
    initializeSse(res);
    const controller = new AbortController();
    res.once("close", () => controller.abort());
    const write = (event: GovernanceStreamEvent, seq?: number) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(
          `${seq === undefined ? "" : `id: ${seq}\n`}data: ${JSON.stringify(event)}\n\n`,
        );
    };
    const terminal = async (s: RuntimeRunSnapshot) => {
      const status = governanceStatus(s.run);
      await governanceStore.closeRun(
        id,
        owner,
        runId,
        status === "failed" ? failureMessage(s.run) : undefined,
      );
      write(
        status === "failed"
          ? {
              type: "error",
              error: failureMessage(s.run),
              timestamp: Date.now(),
            }
          : {
              type: "response_end",
              status: status === "idle" ? "completed" : "cancelled",
            },
        s.cursor.seq,
      );
      res.end();
    };
    try {
      while (!controller.signal.aborted) {
        const work = (await governanceStore.runWork(runIdentity, owner)).work;
        write(
          {
            type: "snapshot",
            runId,
            messages: governanceLiveSnapshot(snapshot),
            work,
          },
          snapshot.cursor.seq,
        );
        if (snapshot.run.status !== "running") {
          await terminal(snapshot);
          return;
        }
        let refresh = false,
          ended = false;
        await client.stream(
          snapshot.cursor,
          async (frame) => {
            if (frame.type === "snapshot_required") {
              refresh = true;
              return;
            }
            const { event, cursor } = frame.envelope;
            if (
              event.type === "message_update" &&
              event.assistantMessageEvent.type === "text_delta"
            )
              write(
                { type: "token", content: event.assistantMessageEvent.delta },
                cursor.seq,
              );
            else if (event.type === "tool_execution_start")
              write(
                {
                  type: "tool_start",
                  toolCallId: event.toolCallId,
                  tool: event.toolName,
                  args: event.args,
                },
                cursor.seq,
              );
            else if (event.type === "tool_execution_end") {
              write(
                {
                  type: "tool_end",
                  toolCallId: event.toolCallId,
                  tool: event.toolName,
                  result: { content: event.result.content },
                  isError: event.isError,
                },
                cursor.seq,
              );
              write({
                type: "work",
                work: (await governanceStore.runWork(runIdentity, owner)).work,
              });
            } else if (event.type === "agent_end") {
              ended = true;
              await terminal(await client.run(runId));
            }
          },
          controller.signal,
        );
        if (ended || controller.signal.aborted) return;
        if (!refresh) {
          write({ type: "response_unavailable" });
          res.end();
          return;
        }
        snapshot = await client.run(runId);
      }
    } catch {
      if (!controller.signal.aborted) {
        write({ type: "response_unavailable" });
        res.end();
      }
    }
  }
}
export const governanceRuntime = new GovernanceRuntime();
