import { agentExecutionOptionsSchema } from "@ontomato/contracts/assistant-chat";
import { config } from "../../config/application";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

/** The existing identity owner resolves names in the initiator's domain, while self mode keeps the authenticated initiator's own display name. */
export async function panelConfirmation(credentials: AssistantCredentials, input: { operation: string; target: string; executionUserId: string | null; initiatorName: string; impactSummary?: string }) {
  let executor = input.initiatorName;
  if (input.executionUserId !== null) {
    const query = new URLSearchParams({ selected: input.executionUserId, pageSize: "1" });
    const response = await backendGet("panel-executor-name", `${config.dataQuery.baseUrl}/platform/agent-execution/options?${query}`, {
      headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers), retries: 1,
    });
    executor = agentExecutionOptionsSchema.required({ selected: true }).parse(JSON.parse(response.text)).selected.name;
  }
  const text = (key: string) => tForLocale(credentials.locale, `panels.confirmation.${key}`);
  return {
    message: [
      tForLocale(credentials.locale, "panels.confirmation.message", { operation: input.operation, target: input.target, executor }),
      input.impactSummary,
    ].filter(Boolean).join("\n"),
    defaultAssumption: text("default"),
    options: [{ label: text("decline"), isDefault: true }, { label: text("approve") }],
  };
}
