import { z } from "zod";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";
import { readRefusal } from "../action/object-actions";

/*
 * Minimal read-only list adapter for `platform:Workflow`, backed by the existing `/workflow/query` owner endpoint so
 * callers such as Triggers can list workflows before the full Workflow panel owner lands.
 */

const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  version: z.number().nullish(),
  steps: z.array(z.unknown()).nullish(),
}).passthrough();
type WorkflowAsset = z.infer<typeof workflowSchema>;

function statusTone(status: string | null | undefined): "success" | "warning" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return "info";
}

function workflowRecord(workflow: WorkflowAsset, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: workflow.id,
    label: workflow.name,
    ...(workflow.description ? { subtitle: workflow.description } : {}),
    fieldLabels,
    fields: {
      status: workflow.status ?? "",
      version: workflow.version == null ? "" : String(workflow.version),
      stepCount: String(workflow.steps?.length ?? 0),
    },
    tones: { status: statusTone(workflow.status) },
  };
}

export function createWorkflowReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const translate = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => Object.fromEntries(
    ["status", "version", "stepCount"].map(name => [name, translate(`panels.workflow.fields.${name}`)]),
  );

  return {
    async list(): Promise<PanelRecord[]> {
      const response = await backendPost("workflow-list", `${base}/workflow/query`, {}, options);
      const envelope = ownerEnvelopeSchema.parse(JSON.parse(response.text));
      if (!envelope.success) throw readRefusal(envelope, "WORKFLOW_READ_FAILED", "The owner could not read the workflows");
      const labels = fieldLabels();
      return z.array(workflowSchema).parse(envelope.data).map(workflow => workflowRecord(workflow, labels));
    },
  };
}
