import { z } from "zod";
import { runtimeIdSchema } from "@ontomato/contracts/agent-runtime-values";
import { agentExecutionOptionsSchema, type AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormRequest, PanelOption, PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { assertPermission } from "../../identity/installed";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { describeAgentDefinitionForm } from "./definition-form";
import { agentDefinitionPermissions, listAgentDefinitions, readAgentDefinition } from "./definitions";
import { queryExecutionOptions } from "./execution-setting";
import { readDomainModelOptions } from "./model-panel-form";
import type { AssistantOwner } from "./store";

type FormInputs = Pick<PanelFormRequest, "values" | "changedField">;

export function createAgentDefinitionReadAdapter(owner: AssistantOwner, viewer: AssistantCredentials) {
  const admit = () => assertPermission(viewer, agentDefinitionPermissions);
  const id = z.string().uuid();
  const fieldLabels = () => ({
    name: tForLocale(viewer.locale, "panels.agentForm.name"),
    description: tForLocale(viewer.locale, "panels.agentForm.description"),
    enabled: tForLocale(viewer.locale, "panels.agentForm.enabled"),
  });
  const record = ({ id, name, description, enabled }: AssistantAgentDefinition): PanelRecord => ({
    primaryKey: id,
    label: name,
    fields: { name, description, enabled: tForLocale(viewer.locale, enabled ? "panels.agentForm.enabledOn" : "panels.agentForm.enabledOff") },
    fieldLabels: fieldLabels(),
    tones: { enabled: enabled ? "success" : "default" },
  });
  return {
    async list() {
      await admit();
      return (await listAgentDefinitions(owner, viewer)).agents.map(record);
    },
    async record(primaryKey: string) {
      await admit();
      return record(await readAgentDefinition(id.parse(primaryKey), owner, viewer));
    },
    async form(primaryKey: string, params: FormInputs) {
      await admit();
      return describeAgentDefinitionForm({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey }, ...params }, owner, viewer);
    },
    async createForm(params: FormInputs) {
      await admit();
      return describeAgentDefinitionForm({ target: { kind: "draft" }, ...params }, owner, viewer);
    },
  };
}

export function createAgentOptionReadAdapters(viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, `panels.agentOptions.${key}`);
  const userId = agentExecutionOptionsSchema.shape.users.element.shape.id;
  const defaultOption = (label: string): PanelOption => ({ primaryKey: "@default", value: null, label });
  const modelOptions = () => readDomainModelOptions(viewer);
  /** Running with the reader's own permissions: the empty choice of whose permissions an agent runs with. */
  const readersOwn = () => defaultOption(text("executionOwn"));

  return {
    models: {
      async options() { return { options: await modelOptions() }; },
      async resolve(values: readonly unknown[]) {
        const options = new Map((await modelOptions()).map(option => [option.value, option]));
        return { options: values.map((value): PanelOption => {
          if (value === null) return options.get(null)!;
          const ref = modelReferenceSchema.parse(value);
          return options.get(ref) ?? { primaryKey: ref, value: ref, label: ref, unavailable: { reason: text("unavailable") } };
        }) };
      },
    },
    users: {
      async options({ keyword, page }: { keyword?: string; page?: { number: number; size: number } }) {
        const query = new URLSearchParams();
        if (keyword !== undefined) query.set("keyword", keyword);
        if (page) {
          query.set("pageNum", String(page.number));
          query.set("pageSize", String(page.size));
        }
        const { users } = await queryExecutionOptions(viewer, query);
        const members = users.map(({ id, name }): PanelOption => ({ primaryKey: id, value: id, label: name }));
        // The empty choice heads the first page only, as every page after it continues the same list.
        return { options: (page?.number ?? 1) === 1 ? [readersOwn(), ...members] : members };
      },
      async resolve(values: readonly unknown[]) {
        return { options: await Promise.all(values.map(async (value): Promise<PanelOption> => {
          if (value === null) return readersOwn();
          const id = userId.parse(value);
          const { selected } = await queryExecutionOptions(viewer, new URLSearchParams({ selected: id, pageSize: "1" }));
          if (!selected) throw new Error("The execution user owner did not return the requested selection");
          return {
            primaryKey: selected.id, value: selected.id, label: selected.name,
            ...(!selected.available && { unavailable: { reason: text(selected.reason ?? "unavailable") } }),
          };
        })) };
      },
    },
  };
}

export function createMcpServiceOptionReadAdapter(owner: AssistantOwner, viewer: AssistantCredentials) {
  const runtime = new RuntimeClient(owner.domainId, undefined, owner.userId);
  const list = async (): Promise<PanelOption[]> =>
    (await runtime.mcpOptions()).map(({ id, name }) => ({ primaryKey: id, value: id, label: name }));

  return {
    async options() {
      return { options: await list() };
    },
    async resolve(values: readonly unknown[]) {
      const ids = values.map(value => runtimeIdSchema.parse(value));
      const options = new Map((await list()).map(option => [option.primaryKey, option]));
      const reason = tForLocale(viewer.locale, "panels.agentOptions.unavailable");
      return { options: ids.map(id => options.get(id) ?? { primaryKey: id, value: id, label: id, unavailable: { reason } }) };
    },
  };
}
