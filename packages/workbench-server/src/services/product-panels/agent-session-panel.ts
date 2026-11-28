import { localReadRegistration, type RegisteredDataReadRegistration } from "./registered-data-read";
import { z } from "zod";
import type { AgentHostRunStatus } from "@ontomato/contracts/agent-host";
import type { PanelRecord, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { AGENT_SESSION, DELETE_AGENT_SESSION, FAVORITE, RENAME_AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import { resolveLocale, tForLocale } from "../../i18n";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runOutcome } from "../../platform/agent-runtime/projection";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assistantName } from "../assistant/labels";
import { assistantStore } from "../assistant/store";
import { favoriteTargetKey, isFavoriteTarget, readFavoriteKeySet } from "../platform-home/service";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

const sessionTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(AGENT_SESSION),
  primaryKey: z.string().uuid(),
}).strict();

const renameInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
}).strict();

const renameResultSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().min(1),
}).strict();

const sessionText = (locale: string | undefined, key: string) => tForLocale(locale, `panels.agentSession.${key}`);

/** Strip legacy JSON prompt prefixes from older session titles so lists show the business label cleanly. */
export function cleanSessionDisplayTitle(rawTitle: string, fallback: string): string {
  const title = rawTitle ?? "";
  const resourceTitle = title.match(/"(?:resource|kind)"[\s\S]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (resourceTitle) {
    try {
      const parsed = JSON.parse(`"${resourceTitle[1]}"`);
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    } catch {
      // Fall through to readable cleanup.
    }
  }
  const readable = title
    .replace(/\s*[（(][^()（）]*(?:dashboardId|cardId|sessionId|taskId|runId)\s*[:：][^()（）]*[）)]/gi, "")
    .split(/\n|\{\s*"|(?:dashboardId|cardId|sessionId|taskId|runId)\s*[:：]/i)[0]!
    .replace(/(?:个人工作台协作请求|分析上下文)\s*[:：]\s*/g, "")
    .replace(/(?:请先读取当前信息|对象引用)\s*[:：]?[\s\S]*$/, "")
    .replace(/^请分析对象[「“]([^」”]+)[」”][。.]?$/, "$1 · 对象分析")
    .replace(/[\s，,；;：:]+$/, "")
    .trim();
  return readable || fallback;
}

export function sessionOpenPath(agentId: string, sessionId: string): string {
  return `/agents/chat?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`;
}

/** Format an ISO timestamp into a compact locale-aware date/time label for workspace list subtitles. */
export function formatShortDateTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

type SessionListOptions = Parameters<typeof assistantStore.listSessions>[1];

const cursorSchema = z.object({ updatedAt: z.string().datetime(), id: z.string().uuid() }).strict();
type SessionTaskParams = Omit<SessionListOptions, "after" | "hasRun" | "workspaceId"> & {
  cursor?: string;
  workspaceId?: string;
};

function decodeSessionCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
  } catch {
    throw new HttpError(400, "Invalid session cursor", "INVALID_REQUEST");
  }
}

function encodeSessionCursor(row: { id: string; cursorUpdatedAt: string }) {
  return Buffer.from(JSON.stringify({ updatedAt: row.cursorUpdatedAt, id: row.id })).toString("base64url");
}

function sessionRunFields(latestRun: AgentHostRunStatus | null, locale: string | undefined) {
  const status = latestRun
    ? runOutcome({ ...latestRun, status: latestRun.delegatedRunning ? "running" : latestRun.status })
    : "pending";
  const running = status === "running";
  return {
    status,
    running,
    runningStatus: running ? sessionText(locale, "running") : "",
    latestRun: { kind: "json" as const, value: latestRun },
  };
}

export function createAgentSessionReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const language = resolveLocale(viewer.locale);
  const untitled = sessionText(viewer.locale, "untitled");
  const fieldLabels = {
    title: sessionText(viewer.locale, "title"),
    agentName: sessionText(viewer.locale, "agentName"),
    updatedAt: sessionText(viewer.locale, "updatedAt"),
  };

  async function readSessions(options: SessionListOptions, paginate: boolean): Promise<PanelRecordQuery> {
    const limit = Math.max(1, Math.min(50, options.limit ?? 20));
    const [found, favoriteKeys] = await Promise.all([
      assistantStore.listSessions(owner, { ...options, limit: limit + Number(paginate) }),
      readFavoriteKeySet(owner),
    ]);
    const sessions = found.slice(0, limit);
    const statuses = sessions.length
      ? await new RuntimeClient(owner.domainId, undefined, owner.userId).sessionStatuses(sessions.map(item => item.id))
      : [];
    const statusesById = new Map(statuses.map(item => [item.session.id, item]));
    const rows = sessions.map((item): PanelRecord => {
      const displayTitle = cleanSessionDisplayTitle(item.title, untitled);
      const favorited = favoriteKeys.has(favoriteTargetKey(AGENT_SESSION, item.id));
      const updatedAt = item.updated_at.toISOString();
      const agentName = assistantName({ kind: item.agentKind ?? "", name: item.agentName ?? "" }, viewer.locale);
      const subtitle = [agentName, formatShortDateTime(updatedAt, language)].filter(Boolean).join(" · ");
      const run = sessionRunFields(statusesById.get(item.id)!.latestRun, viewer.locale);
      return {
        className: AGENT_SESSION,
        primaryKey: item.id,
        label: displayTitle,
        ...(subtitle ? { subtitle } : {}),
        fields: {
          title: displayTitle,
          agentId: item.agent_id,
          agentName,
          ...(item.agentKind === null ? {} : { agentKind: item.agentKind }),
          origin: item.origin,
          ...(item.workspace_id === null ? {} : { workspaceId: item.workspace_id }),
          createdAt: item.created_at.toISOString(),
          updatedAt,
          favorite: favorited,
          ...run,
        },
        ...(run.running ? { tones: { runningStatus: "info" } } : {}),
        fieldLabels,
        outputs: {
          openPath: sessionOpenPath(item.agent_id, item.id),
          favorited,
        },
      };
    });
    const hasMore = found.length > limit;
    return {
      rows,
      hasMore,
      ...(hasMore && { nextCursor: encodeSessionCursor(sessions[limit - 1]!) }),
    };
  }

  return {
    async list({ agentKind, ...params }: { search?: string; limit?: number; agentKind?: string; agentId?: string } = {}): Promise<PanelRecord[]> {
      return (await readSessions({
        ...params,
        ...(agentKind !== undefined && { agentKinds: [agentKind] }),
        origins: ["user"],
        hasRun: true,
      }, false)).rows;
    },

    tasks({ cursor, workspaceId, ...params }: SessionTaskParams): Promise<PanelRecordQuery> {
      return readSessions({
        ...params,
        workspaceId: workspaceId === "none" ? null : workspaceId,
        after: cursor === undefined ? undefined : decodeSessionCursor(cursor),
      }, true);
    },

    async record(sessionId: string): Promise<PanelRecord> {
      const [session, favorited, statuses] = await Promise.all([
        assistantStore.session(sessionId, owner),
        isFavoriteTarget(owner, AGENT_SESSION, sessionId),
        new RuntimeClient(owner.domainId, undefined, owner.userId).sessionStatuses([sessionId]),
      ]);
      const displayTitle = cleanSessionDisplayTitle(session.title, untitled);
      const openPath = sessionOpenPath(session.agent_id, session.id);
      const run = sessionRunFields(statuses[0]?.latestRun ?? null, viewer.locale);
      return {
        className: AGENT_SESSION,
        primaryKey: session.id,
        label: displayTitle,
        fields: {
          title: displayTitle,
          agentId: session.agent_id,
          updatedAt: session.updated_at.toISOString(),
          favorite: favorited,
          ...run,
        },
        ...(run.running ? { tones: { runningStatus: "info" as const } } : {}),
        fieldLabels,
        outputs: {
          openPath,
          favorited,
        },
      };
    },
  };
}

async function ownedSessionLabel(host: PanelOperationHost, primaryKey: string): Promise<string> {
  const session = await assistantStore.session(primaryKey, host.initiator.owner);
  return cleanSessionDisplayTitle(session.title, sessionText(host.locale, "untitled"));
}

export const agentSessionServerOperations: readonly PanelWriteServerOperation[] = [
  {
    handlerRef: RENAME_AGENT_SESSION,
    labelKey: "panels.agentSession.rename",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RENAME_AGENT_SESSION },
    effect: "write",
    batch: false,
    targetType: AGENT_SESSION,
    targetInput: "session",
    targetSchema: sessionTargetSchema,
    inputSchema: renameInputSchema,
    resultSchema: renameResultSchema,
    async targetLabel(host, { primaryKey }) {
      const untitled = sessionText(host.locale, "untitled");
      try {
        const row = await assistantStore.session(primaryKey, host.executor.owner);
        return cleanSessionDisplayTitle(row.title, untitled);
      } catch {
        return primaryKey;
      }
    },
    done(host, name) {
      return tForLocale(host.locale, "panels.agentSession.renamed", { name });
    },
    async execute({ executor }: PanelOperationHost, target, input): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = sessionTargetSchema.parse(target);
      const { title } = renameInputSchema.parse(input);
      try {
        const updated = await assistantStore.renameSession(executor.owner, primaryKey, title);
        return {
          kind: "success",
          data: { sessionId: updated.sessionId, title: updated.title },
          affected: {
            objectTypes: [AGENT_SESSION, FAVORITE],
            objects: [{ objectType: AGENT_SESSION, primaryKey: updated.sessionId }],
          },
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "SESSION_RENAME_REFUSED", message: error.message };
      }
    },
  },
  {
    handlerRef: DELETE_AGENT_SESSION,
    labelKey: "panels.agentSession.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_AGENT_SESSION },
    effect: "write",
    batch: false,
    targetType: AGENT_SESSION,
    targetInput: "session",
    targetSchema: sessionTargetSchema,
    inputSchema: z.object({}).strict(),
    resultSchema: renameResultSchema.pick({ sessionId: true }),
    targetLabel: (host, { primaryKey }) => ownedSessionLabel(host, primaryKey),
    inspectImpact: {
      handlerRef: `${DELETE_AGENT_SESSION}.inspect-impact`,
      async inspect(host, calls) {
        const { primaryKey } = sessionTargetSchema.parse(calls[0]!.target);
        const name = await ownedSessionLabel(host, primaryKey);
        return {
          summary: tForLocale(host.locale, "panels.agentSession.deleteImpact", { name }),
          objects: [{ target: { objectType: AGENT_SESSION, primaryKey }, label: name }],
          total: 1,
        };
      },
    },
    done(host, name) {
      return tForLocale(host.locale, "panels.agentSession.deleted", { name });
    },
    async execute({ executor }, target) {
      const { primaryKey } = sessionTargetSchema.parse(target);
      const { assistantService } = await import("../assistant/service");
      try {
        await assistantService.delete(primaryKey, executor.owner);
        return {
          kind: "success",
          data: { sessionId: primaryKey },
          affected: {
            objectTypes: [AGENT_SESSION, FAVORITE],
            objects: [{ objectType: AGENT_SESSION, primaryKey }],
          },
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "SESSION_DELETE_REFUSED", message: error.message };
      }
    },
  },
];

export const agentSessionDataReadRegistrations: RegisteredDataReadRegistration[] = [
  localReadRegistration(AGENT_SESSION, "tasks", {
    read: (owner, _ranges, _facts, credentials, _key, params) =>
      createAgentSessionReadAdapter(owner, credentials).tasks(params as SessionTaskParams),
  }),
  localReadRegistration(AGENT_SESSION, "list", {
    read: (owner, _ranges, _facts, credentials, _key, params) => createAgentSessionReadAdapter(owner, credentials)
      .list(params as Parameters<ReturnType<typeof createAgentSessionReadAdapter>["list"]>[0]),
  }),
  localReadRegistration(AGENT_SESSION, "record", {
    read: (owner, _ranges, _facts, credentials, primaryKey) => createAgentSessionReadAdapter(owner, credentials).record(primaryKey!),
  }),
];
