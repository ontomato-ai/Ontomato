import { z } from "zod";
import { panelReadParameterSchemas, type PanelFieldTone, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";

const auditRecordSchema = z.object({
  id: z.string().min(1),
  bussiness: z.string().nullish(),
  operation: z.string().nullish(),
  description: z.string().nullish(),
  userId: z.string().nullish(),
  userName: z.string().nullish(),
  byAi: z.boolean().nullish(),
  paramter: z.string().nullish(),
  operateTime: z.number().nullish(),
});
const pageSchema = z.object({ data: z.array(auditRecordSchema), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() });
const cursorSchema = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(2147483647));
const querySchema = z.object({
  business: panelReadParameterSchemas.auditLogBusiness.optional(),
  operation: panelReadParameterSchemas.auditLogOperation.optional(),
  cursor: cursorSchema.optional(),
  size: panelReadParameterSchemas.size.max(100).optional(),
}).strict();

const businessLabelKeys: Record<string, string> = {
  BKNOWLEDGE: "auditBusinessKnowledge",
  BTERM: "auditBusinessGlossary",
  BEXAMPLE: "auditBusinessExample",
  ANALYSIS: "auditBusinessAnalysis",
};
const operationStyle: Record<string, { key: string; tone: PanelFieldTone }> = {
  ADD: { key: "auditOperationAdd", tone: "info" },
  UPD: { key: "auditOperationModify", tone: "warning" },
  DEL: { key: "auditOperationDelete", tone: "danger" },
};

export function createAuditLogPanelReads(viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  const fieldLabels = () => Object.fromEntries(
    ["business", "operation", "description", "userId", "userName", "byAi", "parameters", "operateTime"]
      .map(key => [key, text(key)]),
  );
  function formatBusiness(code: string | null | undefined): string {
    if (!code) return "";
    if (code === "SCHEMA") return "Schema";
    const key = businessLabelKeys[code];
    return key ? text(key) : code;
  }
  function formatOperation(code: string | null | undefined): { label: string; tone?: PanelFieldTone } {
    if (!code) return { label: "" };
    const matched = operationStyle[code];
    return matched ? { label: text(matched.key), tone: matched.tone } : { label: code, tone: "default" };
  }
  function record(entry: z.infer<typeof auditRecordSchema>, labels: Record<string, string>, detail: boolean): PanelRecord {
    const business = formatBusiness(entry.bussiness);
    const op = formatOperation(entry.operation);
    const tones: Record<string, PanelFieldTone> = {};
    if (business) tones.business = "default";
    if (op.tone) tones.operation = op.tone;
    return {
      primaryKey: entry.id, label: entry.description || entry.id, fieldLabels: labels,
      fields: {
        business, operation: op.label, description: entry.description ?? "",
        userId: entry.userId ?? "", userName: entry.userName ?? "",
        byAi: entry.byAi == null ? "" : String(entry.byAi),
        operateTime: entry.operateTime == null ? "" : new Date(entry.operateTime).toISOString(),
        ...(detail && { parameters: entry.paramter ?? "" }),
      },
      ...(Object.keys(tones).length > 0 && { tones }),
    };
  }
  async function read(path: string, body: object) {
    await assertPermission(viewer, ["audit-logs"]);
    const response = await backendPost(`audit-log-${path}`, `${config.dataQuery.baseUrl.replace(/\/$/, "")}/auditLog/${path}`, body, {
      headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
    });
    return JSON.parse(response.text);
  }
  return {
    async query(params: Record<string, unknown>) {
      const { cursor = 1, size = 20, business, operation } = querySchema.parse(params);
      const page = pageSchema.parse(await read("queryPage", { pageNum: cursor, pageSize: size, bussiness: business, operation }));
      const labels = fieldLabels();
      return {
        rows: page.data.map(entry => record(entry, labels, false)),
        total: page.totalRows,
        ...(cursor < page.totalPages && { nextCursor: String(cursor + 1) }),
      };
    },
    async record(primaryKey: string) {
      return record(auditRecordSchema.parse(await read("queryById", { id: primaryKey })), fieldLabels(), true);
    },
  };
}
