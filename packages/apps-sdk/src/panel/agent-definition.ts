import { assistantAgentDefinitionListSchema, assistantAgentDefinitionSchema, assistantAgentPanelValuesSchema, assistantAgentPanelUpdateValuesSchema, type AssistantAgentDefinitionSummary } from "@ontomato/contracts/assistant-chat";
import { AGENT_DEFINITION } from "@ontomato/contracts/panel-client-requests";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { randomId } from "@ontomato/contracts/random-id";
import { PlatformObjectRefusal, type PlatformObjectAdapterFactory, type PlatformRequests } from "./platform-objects";

const base = "/assistant/agent-definitions";
const pathOf = (id: string) => `${base}/${encodeURIComponent(id)}`;
const record = (definition: AssistantAgentDefinitionSummary) => ({
  primaryKey: definition.id,
  label: definition.name,
  fields: { name: definition.name, description: definition.description, enabled: String(definition.enabled) },
});

async function definitionRequest(requests: PlatformRequests, path: string, init: NonNullable<Parameters<typeof fetch>[1]>) {
  try {
    return await (await requests.request(path, init, "")).json();
  } catch (error) {
    // The bridge's HTTP error carries the owner's body. The form owner names fields by JSON Pointer.
    const payload = (error as { payload?: unknown }).payload as {
      error?: string | { message: string }; details?: { fields?: { field: string; message: string }[] };
    } | undefined;
    if (!payload?.error) throw error;
    const fields = Object.fromEntries((payload.details?.fields ?? []).map(field => [field.field, field.message]));
    throw new PlatformObjectRefusal(typeof payload.error === "string" ? payload.error : payload.error.message, fields, { cause: error });
  }
}

export const agentDefinitionAdapters: PlatformObjectAdapterFactory = requests => [{
  objectType: AGENT_DEFINITION,
  async list() {
    const agents: ReturnType<typeof record>[] = [];
    let cursor: string | null = null;
    do {
      const path = cursor === null ? base : `${base}?${new URLSearchParams({ cursor })}`;
      const page = assistantAgentDefinitionListSchema.parse(await definitionRequest(requests, path, {}));
      agents.push(...page.agents.map(record));
      cursor = page.nextCursor;
    } while (cursor !== null);
    return agents;
  },
  async read(primaryKey) {
    return record(assistantAgentDefinitionSchema.parse(await definitionRequest(requests, pathOf(primaryKey), {})));
  },
  forms: {
    async describe(request) {
      const description = await definitionRequest(requests, `${base}/form`, { method: "POST", body: JSON.stringify(request) });
      return panelFormDescriptionSchema.parse(description);
    },
    async save(target, { values }) {
      const create = target.kind === "draft";
      const response = await definitionRequest(requests, create ? base : pathOf(target.primaryKey), {
        method: create ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", ...(create ? { "Idempotency-Key": randomId() } : {}) },
        body: JSON.stringify((create ? assistantAgentPanelValuesSchema : assistantAgentPanelUpdateValuesSchema).parse(values)),
      });
      return record(assistantAgentDefinitionSchema.parse(response));
    },
  },
}];
