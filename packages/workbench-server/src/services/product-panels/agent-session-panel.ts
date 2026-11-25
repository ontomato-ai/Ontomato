import { z } from "zod";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { AGENT_SESSION, FAVORITE, RENAME_AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assistantStore } from "../assistant/store";
import { favoriteTargetKey, isFavoriteTarget, readFavoriteKeySet } from "../platform-home/service";
import type { ProductOwner } from "../product-governance/grants";
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

export function createAgentSessionReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const language = resolveLocale(viewer.locale);
  const untitled = sessionText(viewer.locale, "untitled");
  const fieldLabels = {
    title: sessionText(viewer.locale, "title"),
    agentName: sessionText(viewer.locale, "agentName"),
    updatedAt: sessionText(viewer.locale, "updatedAt"),
  };

  return {
    async list(params: { search?: string; limit?: number } = {}): Promise<PanelRecord[]> {
      const [sessions, favoriteKeys] = await Promise.all([
        assistantStore.listUserSessions(owner, params),
        readFavoriteKeySet(owner),
      ]);
      return sessions.map(item => {
        const displayTitle = cleanSessionDisplayTitle(item.title, untitled);
        const favorited = favoriteKeys.has(favoriteTargetKey(AGENT_SESSION, item.sessionId));
        const openPath = sessionOpenPath(item.agentId, item.sessionId);
        const formattedUpdatedAt = formatShortDateTime(item.updatedAt, language);
        const subtitle = [item.agentName, formattedUpdatedAt].filter(Boolean).join(" · ");
        return {
          className: AGENT_SESSION,
          primaryKey: item.sessionId,
          label: displayTitle,
          ...(subtitle ? { subtitle } : {}),
          fields: {
            title: displayTitle,
            agentId: item.agentId,
            agentName: item.agentName,
            updatedAt: item.updatedAt,
            favorite: favorited,
          },
          fieldLabels,
          outputs: {
            openPath,
            favorited,
          },
        };
      });
    },

    async record(sessionId: string): Promise<PanelRecord> {
      const [session, favorited] = await Promise.all([
        assistantStore.session(sessionId, owner),
        isFavoriteTarget(owner, AGENT_SESSION, sessionId),
      ]);
      const displayTitle = cleanSessionDisplayTitle(session.title, untitled);
      const openPath = sessionOpenPath(session.agent_id, session.id);
      return {
        className: AGENT_SESSION,
        primaryKey: session.id,
        label: displayTitle,
        fields: {
          title: displayTitle,
          agentId: session.agent_id,
          updatedAt: session.updated_at.toISOString(),
          favorite: favorited,
        },
        fieldLabels,
        outputs: {
          openPath,
          favorited,
        },
      };
    },
  };
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
];
