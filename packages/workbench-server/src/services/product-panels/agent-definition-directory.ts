import { z } from "zod";
import {
  ontologyAgentModelSchema, ontologyAgentModelWriteSchema, ontologyAgentModelsSchema, type ModelSelection,
} from "@ontomato/contracts/model-settings";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormDescription, PanelFormRequest } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { createAppBuilderDefinition } from "../app-builder/panel-model";
import { agentDefinitionRecord } from "../assistant/definition-record";
import { formJsonSchema, modelPanelField, modelSelectionWrite } from "../assistant/model-panel-form";
import { createAgentDefinitionReadAdapter } from "../assistant/panel-reads";
import type { AssistantOwner } from "../assistant/store";
import { createOpsDiagnosisDefinition } from "../ops-diagnosis/panel-model";
import { ownerEnvelopeSchema } from "./data-query-operations";
import { operationHost } from "./operation-host";

const retrievalId = "dd3b91b9-9214-4aa6-9937-fb07fd37b232"; // OntologyAgentStore.RETRIEVER
const retrievalPath = `${DATA_QUERY_GATEWAY}/ontology/ai/agent-models`;
export const systemFormValues = modelSelectionWrite.extend({ name: z.string().optional(), description: z.string().optional() });
type SystemAgent = { id: string; name: string; description: string; modelSelection: ModelSelection };
type SystemOwner = {
  read(): Promise<SystemAgent>;
  save(id: string, selection: ModelSelection): Promise<{ modelSelection: ModelSelection }>;
};

export function createSystemAgentOwners(owner: AssistantOwner, viewer: AssistantCredentials) {
  const builder = createAppBuilderDefinition(owner, viewer);
  const diagnosis = createOpsDiagnosisDefinition(owner.domainId, viewer);
  const host = operationHost({ owner, credentials: viewer });
  async function callRetrieval<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init: RequestInit) {
    const response = await host.request(path, init);
    const envelope = ownerEnvelopeSchema.parse(await response.json());
    if (!response.ok || !envelope.success) {
      throw new HttpError(response.ok ? 422 : response.status, envelope.message ?? response.statusText,
        typeof envelope.code === "string" ? envelope.code : response.status === 403 ? "FORBIDDEN" : undefined);
    }
    return schema.parse(envelope.data);
  }
  const retrieval: SystemOwner = {
    async read() {
      const { agents } = await callRetrieval(retrievalPath, ontologyAgentModelsSchema, { method: "GET" });
      const { id, modelSelection } = agents.find(agent => agent.kind === "retrieval")!;
      return {
        id, modelSelection,
        name: tForLocale(viewer.locale, "panels.agentDefinition.retrievalName"),
        description: tForLocale(viewer.locale, "panels.agentDefinition.retrievalDescription"),
      };
    },
    async save(id, modelSelection) {
      const saved = await callRetrieval(`${retrievalPath}/${encodeURIComponent(id)}`, ontologyAgentModelSchema, {
        method: "PUT",
        body: JSON.stringify(ontologyAgentModelWriteSchema.parse({ modelSelection })),
      });
      return { modelSelection: saved.modelSelection };
    },
  };
  const admitted = (source: SystemOwner & { admit(): Promise<void> }): SystemOwner => ({
    async read() {
      await source.admit();
      return source.read();
    },
    async save(id, selection) {
      await source.admit();
      return source.save(id, selection);
    },
  });
  const appBuilder = admitted(builder);
  const opsDiagnosis = admitted(diagnosis);
  return {
    all: [appBuilder, opsDiagnosis, retrieval],
    async forTarget(primaryKey: string) {
      if (primaryKey === DIAGNOSIS_AGENT_ID) return opsDiagnosis;
      if (primaryKey === retrievalId) return retrieval;
      if (z.string().uuid().safeParse(primaryKey).success && await builder.matches(primaryKey)) return appBuilder;
    },
  };
}

async function visibleSources<T>(reads: readonly (() => Promise<T>)[]): Promise<T[]> {
  const results = await Promise.allSettled(reads.map(read => read()));
  const visible: T[] = [];
  let forbidden: HttpError | undefined;
  for (const result of results) {
    if (result.status === "fulfilled") visible.push(result.value);
    else if (result.reason instanceof HttpError && result.reason.status === 403) forbidden = result.reason;
    else throw result.reason;
  }
  if (!visible.length) throw forbidden;
  return visible;
}

function systemAgentForm(agent: SystemAgent, inputs: Pick<PanelFormRequest, "values">, locale?: string): PanelFormDescription {
  const { name, description, modelSelection } = agent;
  const readOnlyField = (key: "name" | "description") => ({
    path: `/${key}`, label: tForLocale(locale, `panels.agentForm.${key}`),
    valueSchema: formJsonSchema(z.string()), readOnly: true, required: false,
    control: { kind: "text" as const },
  });
  return {
    fields: [readOnlyField("name"), readOnlyField("description"), modelPanelField(locale)],
    values: { name, description, modelSelection: inputs.values?.modelSelection ?? modelSelection },
    errors: [],
    save: {
      method: "PUT",
      path: `/assistant/agent-definitions/${agent.id}`,
      bodySchema: formJsonSchema(systemFormValues),
    },
  };
}

export function createAgentDefinitionDirectory(owner: AssistantOwner, viewer: AssistantCredentials) {
  const definitions = createAgentDefinitionReadAdapter(owner, viewer);
  const systems = createSystemAgentOwners(owner, viewer);
  const systemRecord = (agent: SystemAgent) => agentDefinitionRecord({ ...agent, enabled: true }, "system", viewer.locale);
  return {
    async list() {
      return (await visibleSources([
        definitions.list,
        ...systems.all.map(source => async () => [systemRecord(await source.read())]),
      ])).flat();
    },
    async count() {
      const counts = await visibleSources([
        async () => (await definitions.count()).total,
        ...systems.all.map(source => async () => { await source.read(); return 1; }),
      ]);
      return { rows: [], total: counts.reduce((sum, count) => sum + count, 0) };
    },
    async record(primaryKey: string) {
      const source = await systems.forTarget(primaryKey);
      return source ? systemRecord(await source.read()) : definitions.record(primaryKey);
    },
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values" | "changedField">) {
      const source = await systems.forTarget(primaryKey);
      return source ? systemAgentForm(await source.read(), inputs, viewer.locale) : definitions.form(primaryKey, inputs);
    },
    createForm: definitions.createForm,
  };
}
