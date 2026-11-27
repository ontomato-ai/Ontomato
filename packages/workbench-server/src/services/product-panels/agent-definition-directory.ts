import { z } from "zod";
import { agentObjectAccessSchema } from "@ontomato/contracts/object-policy-access";
import {
  ontologyAgentModelSchema, ontologyAgentModelWriteSchema, type ModelSelection,
} from "@ontomato/contracts/model-settings";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormDescription, PanelFormRequest, PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import { createAppBuilderDefinition } from "../app-builder/panel-model";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { agentDefinitionRecord } from "../assistant/definition-record";
import { agentDefinitionFromRow } from "../assistant/definitions";
import { formJsonSchema, modelPanelField, modelSelectionWrite } from "../assistant/model-panel-form";
import {
  agentFormExecutionFactsSchema, describeAgentDefinitionForm, prepareAgentDefinitionFormFromFacts,
} from "../assistant/definition-form";
import { assistantDescription, assistantName } from "../assistant/labels";
import { isPresetAgentKind } from "../assistant/preset-definitions";
import { assistantService } from "../assistant/service";
import { assistantStore, type AssistantOwner, type AgentRow } from "../assistant/store";
import { readFavorites } from "../platform-home/service";
import { createOpsDiagnosisDefinition } from "../ops-diagnosis/panel-model";
import { decideObjects, readAgentAccess, readObjectRanges, requireAllowed, type ObjectVisibilityRange } from "../product-governance/authorization";
import { agentObject, allowedAgents } from "../assistant/authorization";
import { ownerEnvelopeSchema } from "./data-query-operations";
import { operationHost } from "./operation-host";
import { formParams, type PanelReadSelection } from "./panel-owner-reads";
import { localReadRegistration, ownerReadRegistration, type RegisteredDataReadRegistration } from "./registered-data-read";

const retrievalPath = `${DATA_QUERY_GATEWAY}/ontology/ai/agent-models`;
export const systemFormValues = modelSelectionWrite.extend({ name: z.string().optional(), description: z.string().optional() });
type SystemAgent = { id: string; name: string; description: string; modelSelection: ModelSelection; editable?: boolean };
type SystemOwner = {
  read(): Promise<SystemAgent>;
  save(id: string, selection: ModelSelection): Promise<{ modelSelection: ModelSelection }>;
};

const retrieverFactsSchema = ontologyAgentModelSchema.extend({ editable: z.boolean() }).strict();
const agentListFactsSchema = z.object({ retriever: retrieverFactsSchema.nullable() });
const retrieverCountSchema = z.union([z.literal(0), z.literal(1)]);
const localRecordFactsSchema = z.object({ editable: z.boolean(), shared: z.boolean().optional() });
const localFormFactsSchema = agentFormExecutionFactsSchema.extend({ editable: z.boolean() });
const retrievalFormFactsSchema = z.object({ retriever: retrieverFactsSchema });
const retrievalRecordFactsSchema = z.object({ retriever: retrieverFactsSchema, shared: z.boolean().optional() });

function retrievalDefinition({ id, modelSelection, editable }: z.infer<typeof retrieverFactsSchema>, locale?: string) {
  return {
    id, modelSelection, editable,
    name: tForLocale(locale, "panels.agentDefinition.retrievalName"),
    description: tForLocale(locale, "panels.agentDefinition.retrievalDescription"),
  };
}

export function createSystemAgentOwners(owner: AssistantOwner, viewer: AssistantCredentials) {
  const builder = createAppBuilderDefinition(owner, viewer);
  const diagnosis = createOpsDiagnosisDefinition(owner, viewer);
  const host = operationHost({ owner, credentials: viewer });
  async function callRetrieval<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init: NonNullable<Parameters<typeof fetch>[1]>) {
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
      const model = await callRetrieval(
        `${retrievalPath}/${RETRIEVAL_AGENT_ID}`,
        retrieverFactsSchema,
        { method: "GET" },
      );
      return retrievalDefinition(model, viewer.locale);
    },
    async save(id, modelSelection) {
      const saved = await callRetrieval(`${retrievalPath}/${encodeURIComponent(id)}`, ontologyAgentModelSchema, {
        method: "PUT",
        body: JSON.stringify(ontologyAgentModelWriteSchema.parse({ modelSelection })),
      });
      return { modelSelection: saved.modelSelection };
    },
  };
  return {
    builder,
    diagnosis,
    retrieval,
    async forTarget(primaryKey: string) {
      if (primaryKey === RETRIEVAL_AGENT_ID) return retrieval;
      if (await builder.matches(primaryKey)) return builder;
      if (await diagnosis.matches(primaryKey)) return diagnosis;
    },
  };
}

export async function agentPolicyDefinition(
  owner: AssistantOwner, credentials: AssistantCredentials, id: string,
) {
  if (id === RETRIEVAL_AGENT_ID) {
    await createSystemAgentOwners(owner, credentials).retrieval.read();
    return agentObject({ id, domain_id: owner.domainId, owner_id: null });
  }
  return agentObject(await assistantStore.agent(id, owner));
}

function systemAgentForm(agent: SystemAgent, inputs: Pick<PanelFormRequest, "values">, canEdit: boolean, locale?: string): PanelFormDescription {
  const { name, description, modelSelection } = agent;
  const text = (key: string) => tForLocale(locale, `panels.agentForm.${key}`);
  const readOnlyField = (key: "name" | "description") => ({
    path: `/${key}`, label: text(key), section: "basics",
    valueSchema: formJsonSchema(z.string()), readOnly: true, required: false,
    control: { kind: "text" as const, ...(key === "description" ? { multiline: true } : {}) },
  });
  return {
    sections: [
      { key: "basics", title: text("sections.basics") },
      { key: "model", title: text("sections.model"), hint: text("sections.modelHint") },
    ],
    fields: [
      readOnlyField("name"),
      readOnlyField("description"),
      {
        ...modelPanelField(locale), section: "model",
        ...(!canEdit && { readOnly: true, readOnlyReason: text("editReadOnly") }),
      },
    ],
    values: { name, description, modelSelection: inputs.values?.modelSelection ?? modelSelection },
    errors: [],
    save: {
      method: "PUT",
      path: `/assistant/agent-definitions/${agent.id}`,
      bodySchema: formJsonSchema(systemFormValues),
    },
  };
}

const agentId = z.string().uuid();
function validateId(primaryKey: string) {
  if (!agentId.safeParse(primaryKey).success)
    throw new HttpError(400, "Invalid agent definition target", "INVALID_REQUEST");
}

export interface VisibleAgentMcpUsage {
  /** Whether the caller can view at least one MCP-capable agent definition in this domain. */
  readonly hasVisibleAgents: boolean;
  /** Caller-visible agent display names grouped by enabled external MCP service ID. */
  readonly byServiceId: ReadonlyMap<string, readonly string[]>;
}

/**
 * Returns caller-visible agents' external MCP service references using the agent owner's own
 * definition authorization.
 */
export async function readVisibleAgentMcpUsages(
  owner: AssistantOwner,
  viewer: AssistantCredentials,
): Promise<VisibleAgentMcpUsage> {
  const agents = (await assistantStore.channelAgents(owner.domainId))
    .filter(agent => !isAppBuilderKind(agent.kind) && !isOpsDiagnosisKind(agent.kind));
  return visibleAgentMcpUsage(await allowedAgents(agents, "VIEW", viewer), viewer.locale);
}

export async function readVisibleAgentMcpUsagesInRange(domainId: string, locale: string | undefined, view: ObjectVisibilityRange) {
  const agents = await assistantStore.agentDefinitionRelationRows(domainId, view, "enabled_mcp_service_ids");
  return visibleAgentMcpUsage(agents, locale);
}

function visibleAgentMcpUsage(
  visible: readonly Pick<AgentRow, "kind" | "name" | "enabled_mcp_service_ids">[], locale: string | undefined,
): VisibleAgentMcpUsage {
  const byServiceId = new Map<string, string[]>();
  for (const agent of visible) {
    const label = assistantName(agent, locale);
    for (const serviceId of agent.enabled_mcp_service_ids ?? []) {
      const list = byServiceId.get(serviceId);
      if (list) list.push(label);
      else byServiceId.set(serviceId, [label]);
    }
  }
  return { hasVisibleAgents: visible.length > 0, byServiceId };
}

type FormInputs = Pick<PanelFormRequest, "values" | "changedField">;

export function createAgentDefinitionDirectory(owner: AssistantOwner, viewer: AssistantCredentials) {
  const systems = createSystemAgentOwners(owner, viewer);
  const word = (key: string) => tForLocale(viewer.locale, `panels.productCatalog.${key}`);
  const catalogueWord = (key: string) => word(`application.${key}`);
  const storedRecord = (agent: Pick<AgentRow, "id" | "kind" | "name" | "description" | "enabled" | "icon">,
    canEdit: boolean, domainShared?: boolean,
  ) => agentDefinitionRecord({
    id: agent.id,
    name: assistantName(agent, viewer.locale),
    description: assistantDescription(agent, viewer.locale),
    enabled: agent.enabled,
    icon: agent.icon,
  }, isPresetAgentKind(agent.kind) ? "preset" : "custom", viewer.locale, canEdit, domainShared);
  const systemRecord = (agent: SystemAgent, canEdit: boolean, domainShared?: boolean) =>
    agentDefinitionRecord({ ...agent, enabled: true }, "system", viewer.locale, canEdit, domainShared);

  function localRecord(agent: Parameters<typeof storedRecord>[0], canEdit: boolean, domainShared?: boolean) {
    const source = isAppBuilderKind(agent.kind) ? systems.builder : isOpsDiagnosisKind(agent.kind) ? systems.diagnosis : undefined;
    return source ? source.read().then(definition => systemRecord(definition, canEdit, domainShared))
      : storedRecord(agent, canEdit, domainShared);
  }

  async function listInRanges({ VIEW, EDIT }: Record<"VIEW" | "EDIT", ObjectVisibilityRange>, readRetriever: () => Promise<SystemAgent | undefined>) {
    const agents = await assistantStore.agentDefinitionSummaries(owner.domainId, VIEW, { includeSystem: true, editRange: EDIT });
    const local = await Promise.all(agents.map(agent => localRecord(agent, agent.editable)));
    const retriever = await readRetriever();
    return retriever ? [...local, systemRecord(retriever, retriever.editable === true)] : local;
  }

  const countLocal = (view: ObjectVisibilityRange) =>
    assistantStore.countVisibleAgentDefinitions(owner.domainId, view, { includeSystem: true });
  const presentCount = (local: number, retrievers: number) => ({ rows: [], total: local + retrievers });

  async function viewRetrieval() {
    try {
      return await systems.retrieval.read();
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 403)) throw error;
      return undefined;
    }
  }

  async function grants(id: string) {
    validateId(id);
    return readAgentAccess(await agentPolicyDefinition(owner, viewer, id), viewer);
  }

  function presentGrantRows({ grants: policyGrants, shared }: z.infer<typeof agentObjectAccessSchema>): PanelRecord[] {
    return [
      ...policyGrants.map(({ policyId, name, level }): PanelRecord => {
        const verb = level.toLowerCase();
        const levelLabel = level === "VIEW" ? word("grantView") : catalogueWord(level === "EDIT" ? "grantEdit" : "grantUse");
        return {
          primaryKey: policyId,
          className: AGENT_DEFINITION,
          label: name,
          fields: { policyId, level: verb, levelLabel, verb, verbLabel: levelLabel, revocable: true },
          fieldLabels: { levelLabel: catalogueWord("grantVerb"), verbLabel: catalogueWord("grantVerb") },
          tones: { levelLabel: level === "EDIT" ? "warning" : level === "VIEW" ? "info" : "default" },
        };
      }),
      ...(shared ? [{
        primaryKey: "domain", className: AGENT_DEFINITION, label: word("grantDomain"),
        fields: { level: "use", levelLabel: catalogueWord("grantUse"), revocable: false },
      }] : []),
    ];
  }

  async function viewLocal(id: string) {
    const agent = await assistantStore.agent(id, owner);
    const object = agentObject(agent);
    const [view, edit] = await decideObjects([{ ...object, verb: "VIEW" }, { ...object, verb: "EDIT" }], viewer);
    requireAllowed(view);
    return { agent, canEdit: edit.allowed, object };
  }

  return {
    async available(params: { search?: string; favoritesOnly?: boolean } = {}): Promise<PanelRecord[]> {
      const [{ agents }, favorites] = await Promise.all([
        assistantService.agents(owner, viewer),
        readFavorites(owner),
      ]);
      const enabled = agents.filter(agent => agent.enabled);
      const favoriteIds = favorites.filter(item => item.kind === "agent").map(item => item.id);
      const favoriteSet = new Set(favoriteIds);
      const ordered = params.favoritesOnly
        ? favoriteIds.flatMap(id => enabled.find(agent => agent.id === id) ?? [])
        : enabled;
      const queryText = params.search?.trim().toLocaleLowerCase() ?? "";
      return ordered.flatMap((agent): PanelRecord[] => {
        const description = agent.description?.trim() || undefined;
        if (queryText && !`${agent.name}\n${description ?? ""}`.toLocaleLowerCase().includes(queryText)) {
          return [];
        }
        return [{
          primaryKey: agent.id,
          className: AGENT_DEFINITION,
          label: agent.name,
          ...(description && { subtitle: description }),
          fields: {
            category: "agents",
            icon: agent.icon ?? "",
            favorite: favoriteSet.has(agent.id),
          },
          outputs: {
            openPath: `/agents/chat?agentId=${encodeURIComponent(agent.id)}`,
          },
        }];
      });
    },
    async list() {
      return listInRanges(await readObjectRanges("AGENT", ["VIEW", "EDIT"], viewer), viewRetrieval);
    },
    listFromBatch(ranges: Record<"VIEW" | "EDIT", ObjectVisibilityRange>, payload: unknown) {
      const { retriever } = agentListFactsSchema.parse(payload);
      return listInRanges(ranges, async () => retriever ? retrievalDefinition(retriever, viewer.locale) : undefined);
    },
    localRecordFromBatch(agent: AgentRow, payload: unknown) {
      const { editable, shared } = localRecordFactsSchema.parse(payload);
      return localRecord(agent, editable, shared);
    },
    retrievalRecordFromBatch(payload: unknown) {
      const { retriever, shared } = retrievalRecordFactsSchema.parse(payload);
      return systemRecord(retrievalDefinition(retriever, viewer.locale), retriever.editable, shared);
    },
    async count() {
      const [total, retriever] = await Promise.all([
        readObjectRanges("AGENT", ["VIEW"], viewer).then(({ VIEW }) => countLocal(VIEW)),
        viewRetrieval(),
      ]);
      return presentCount(total, Number(retriever !== undefined));
    },
    async countFromBatch(view: ObjectVisibilityRange, payload: unknown) {
      const retrievers = retrieverCountSchema.parse(payload);
      return presentCount(await countLocal(view), retrievers);
    },
    async record(primaryKey: string) {
      validateId(primaryKey);
      if (primaryKey === RETRIEVAL_AGENT_ID) {
        const retriever = await systems.retrieval.read();
        const shared = retriever.editable ? (await grants(primaryKey)).shared : undefined;
        return systemRecord(retriever, retriever.editable === true, shared);
      }
      const { agent, object, canEdit } = await viewLocal(primaryKey);
      const shared = canEdit ? (await readAgentAccess(object, viewer)).shared : undefined;
      return localRecord(agent, canEdit, shared);
    },
    async form(primaryKey: string, inputs: FormInputs) {
      validateId(primaryKey);
      if (primaryKey === RETRIEVAL_AGENT_ID) {
        const retriever = await systems.retrieval.read();
        return systemAgentForm(retriever, inputs, retriever.editable === true, viewer.locale);
      }
      const source = await systems.forTarget(primaryKey);
      if (!source)
        return describeAgentDefinitionForm({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey }, ...inputs }, owner, viewer);
      const { canEdit } = await viewLocal(primaryKey);
      return systemAgentForm(await source.read(), inputs, canEdit, viewer.locale);
    },
    prepareLocalForm(agent: AgentRow, inputs: FormInputs) {
      const source = isAppBuilderKind(agent.kind) ? systems.builder : isOpsDiagnosisKind(agent.kind) ? systems.diagnosis : undefined;
      if (source) return {
        validation: undefined,
        present: (payload: unknown) => {
          const { editable } = localRecordFactsSchema.parse(payload);
          return source.read().then(value => systemAgentForm(value, inputs, editable, viewer.locale));
        },
      };
      const form = prepareAgentDefinitionFormFromFacts({
        target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: agent.id }, ...inputs,
      }, agentDefinitionFromRow(agent, viewer.locale), owner, viewer);
      return { validation: form.validation, present: (payload: unknown) => form.present(localFormFactsSchema.parse(payload)) };
    },
    retrievalFormFromBatch(inputs: FormInputs, payload: unknown) {
      const { retriever } = retrievalFormFactsSchema.parse(payload);
      return systemAgentForm(retrievalDefinition(retriever, viewer.locale), inputs, retriever.editable, viewer.locale);
    },
    prepareCreateForm(inputs: FormInputs) {
      const form = prepareAgentDefinitionFormFromFacts({ target: { kind: "draft" }, ...inputs }, undefined, owner, viewer);
      return {
        validation: form.validation,
        present: (payload: unknown) => form.present({ ...agentFormExecutionFactsSchema.parse(payload), editable: true }),
      };
    },
    async createForm(inputs: FormInputs) {
      return describeAgentDefinitionForm({ target: { kind: "draft" }, ...inputs }, owner, viewer);
    },
    grants,
    async grantRows(primaryKey: string): Promise<PanelRecord[]> {
      return presentGrantRows(await grants(primaryKey));
    },
    grantRowsFromBatch(payload: unknown) {
      return presentGrantRows(agentObjectAccessSchema.parse(payload));
    },
  };
}

export async function prepareAgentDefinitionRead(
  owner: AssistantOwner, viewer: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
) {
  const { typeId, method } = selection;
  if (typeId !== AGENT_DEFINITION || !["record", "grantRows", "form", "createForm"].includes(method)) return;
  const directory = createAgentDefinitionDirectory(owner, viewer);
  if (method === "createForm") {
    const { validation, present } = directory.prepareCreateForm(formParams(params));
    return {
      call: { type: AGENT_DEFINITION, name: method, parameters: { ...(validation && { validation }) } },
      present,
    };
  }
  const primaryKey = selection.primaryKey!;
  validateId(primaryKey);
  if (method === "form") {
    const inputs = formParams(params);
    if (primaryKey === RETRIEVAL_AGENT_ID) return {
      call: { type: AGENT_DEFINITION, name: method, parameters: { primaryKey } },
      present: (payload: unknown) => directory.retrievalFormFromBatch(inputs, payload),
    };
    const agent = await assistantStore.agent(primaryKey, owner);
    const { validation, present } = directory.prepareLocalForm(agent, inputs);
    return {
      call: { type: AGENT_DEFINITION, name: method, parameters: { primaryKey, ownerId: agent.owner_id, ...(validation && { validation }) } },
      present,
    };
  }
  if (primaryKey === RETRIEVAL_AGENT_ID) {
    return {
      call: { type: AGENT_DEFINITION, name: method, parameters: { primaryKey } },
      present: method === "grantRows" ? directory.grantRowsFromBatch : directory.retrievalRecordFromBatch,
    };
  }
  const agent = await assistantStore.agent(primaryKey, owner);
  return {
    call: { type: AGENT_DEFINITION, name: method, parameters: { primaryKey, ownerId: agent.owner_id } },
    present: method === "grantRows" ? directory.grantRowsFromBatch : (payload: unknown) => directory.localRecordFromBatch(agent, payload),
  };
}

export const agentDefinitionDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["record", "grantRows", "form", "createForm"] as const).map(method =>
    ownerReadRegistration(AGENT_DEFINITION, method, ({ owner, credentials, selection, params }) =>
      prepareAgentDefinitionRead(owner, credentials, selection, params))),
  localReadRegistration(AGENT_DEFINITION, "count", {
    visibility: [{ kind: "AGENT", verbs: ["VIEW"] }],
    readJavaFacts: true,
    read: (owner, ranges, facts, credentials) =>
      createAgentDefinitionDirectory(owner, credentials).countFromBatch(ranges!.AGENT.VIEW, facts),
  }),
  localReadRegistration(AGENT_DEFINITION, "list", {
    visibility: [{ kind: "AGENT", verbs: ["VIEW", "EDIT"] }],
    readJavaFacts: true,
    read: (owner, ranges, facts, credentials) =>
      createAgentDefinitionDirectory(owner, credentials).listFromBatch(ranges!.AGENT, facts),
  }),
];
