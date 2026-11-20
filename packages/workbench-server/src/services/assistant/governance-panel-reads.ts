import { z } from "zod";
import {
  governanceSourceReadSchema,
  governanceWorkResponseSchema,
  type GovernanceIssue,
  type GovernanceSource,
} from "@ontomato/contracts/knowledge-governance";
import {
  panelReadParameterSchemas,
  type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";

/*
 * The knowledge governance owner's named reads, forwarded to Java with the viewer's credentials: the work summary
 * record, its issues and sources child lists, and one source's segmented passages encoded by character offset in the
 * cursor.
 */

const sourcePageInputSchema = z.object({
  source: panelReadParameterSchemas.governanceSource,
  cursor: z.string().regex(/^\d+$/).optional(),
}).strict();

export function createKnowledgeGovernanceReadAdapter(viewer: AssistantCredentials, signal?: AbortSignal) {
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
    signal,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const t = (key: string) => tForLocale(viewer.locale, key);

  async function ownerGet<T>(endpoint: string, path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await backendGet(endpoint, `${base}${path}`, options);
    return schema.parse(JSON.parse(response.text));
  }

  function workRecord(primaryKey: string) {
    return ownerGet(
      "governance-work",
      `/ontology/ai/knowledge-governance/${encodeURIComponent(primaryKey)}/work`,
      governanceWorkResponseSchema,
    );
  }

  function issueRow(issue: GovernanceIssue, fieldLabels: Record<string, string>): PanelRecord {
    return {
      primaryKey: issue.id,
      label: issue.title,
      subtitle: `${t(`panels.governance.categories.${issue.category}`)} · ${t(`panels.governance.statuses.${issue.status}`)}`,
      fieldLabels,
      fields: {
        category: t(`panels.governance.categories.${issue.category}`),
        status: t(`panels.governance.statuses.${issue.status}`),
        problem: issue.problem,
        before: issue.before,
        after: issue.after,
        basis: issue.basis,
        sourceIds: issue.sourceIds.join(", "),
      },
    };
  }

  function sourceRow(source: GovernanceSource, fieldLabels: Record<string, string>): PanelRecord {
    return {
      primaryKey: source.id,
      label: source.title,
      subtitle: t(`panels.governance.sourceKinds.${source.kind}`),
      fieldLabels,
      fields: {
        kind: t(`panels.governance.sourceKinds.${source.kind}`),
        target: source.target,
        excerpt: source.excerpt,
      },
    };
  }

  return {
    async record(primaryKey: string): Promise<PanelRecord> {
      const { revision, work } = await workRecord(primaryKey);
      const progress = work.knowledgeTotal === null
        ? String(work.reviewedKnowledgeIds.length)
        : `${work.reviewedKnowledgeIds.length}/${work.knowledgeTotal}`;
      return {
        primaryKey,
        label: work.summary || t("assistant.governance.report.title"),
        fieldLabels: {
          summary: t("panels.governance.fields.summary"),
          revision: t("panels.governance.fields.revision"),
          progress: t("panels.governance.fields.progress"),
          issueCount: t("panels.governance.fields.issueCount"),
          sourceCount: t("panels.governance.fields.sourceCount"),
          notes: t("panels.governance.fields.notes"),
        },
        fields: {
          summary: work.summary,
          revision: String(revision),
          progress,
          issueCount: String(work.issues.length),
          sourceCount: String(work.sources.length),
          notes: work.notes,
        },
      };
    },

    async issues(primaryKey: string): Promise<PanelRecord[]> {
      const { work } = await workRecord(primaryKey);
      const fieldLabels = {
        category: t("panels.governance.fields.category"),
        status: t("panels.governance.fields.status"),
        problem: t("panels.governance.fields.problem"),
        before: t("panels.governance.fields.before"),
        after: t("panels.governance.fields.after"),
        basis: t("panels.governance.fields.basis"),
        sourceIds: t("panels.governance.fields.sourceIds"),
      };
      return work.issues.map(issue => issueRow(issue, fieldLabels));
    },

    async sources(primaryKey: string): Promise<PanelRecord[]> {
      const { work } = await workRecord(primaryKey);
      const fieldLabels = {
        kind: t("panels.governance.fields.kind"),
        target: t("panels.governance.fields.target"),
        excerpt: t("panels.governance.fields.excerpt"),
      };
      return work.sources.map(source => sourceRow(source, fieldLabels));
    },

    async sourcePage(primaryKey: string, params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const { source, cursor } = sourcePageInputSchema.parse(params);
      const offset = cursor === undefined ? 0 : Number(cursor);
      const result = await ownerGet(
        "governance-source-page",
        `/ontology/ai/knowledge-governance/${encodeURIComponent(primaryKey)}/sources/${encodeURIComponent(source)}?offset=${offset}`,
        governanceSourceReadSchema,
      );
      if (!result.page) return { rows: [] };
      const fieldLabels = {
        text: t("panels.governance.fields.text"),
        start: t("panels.governance.fields.start"),
        end: t("panels.governance.fields.end"),
        totalChars: t("panels.governance.fields.totalChars"),
      };
      return {
        rows: result.page.items.map(item => ({
          primaryKey: `${item.id}:${item.start}`,
          label: item.title,
          fieldLabels,
          fields: {
            text: item.text,
            start: String(item.start),
            end: String(item.end),
            totalChars: String(item.totalChars),
          },
        })),
        ...(result.page.next ? { nextCursor: String(result.page.next.offset) } : {}),
      };
    },
  };
}
