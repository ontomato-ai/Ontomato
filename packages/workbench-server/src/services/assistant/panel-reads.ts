import { z } from "zod";
import { agentExecutionOptionsSchema, type AgentExecutionOptions } from "@ontomato/contracts/assistant-chat";
import { modelNameSchema } from "@ontomato/contracts/model-settings";
import { panelReadParameterSchemas, type PanelOption } from "@ontomato/contracts/panel-projection";
import { USER } from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { queryExecutionOptions } from "./execution-setting";
import { presentDomainModelOptions, readDomainModelOptions } from "./model-panel-form";

function resolveModelChoices(options: readonly PanelOption[], values: readonly unknown[], locale?: string) {
  const byValue = new Map(options.map(option => [option.value, option]));
  return { options: values.map((value): PanelOption => {
    if (value === null) return byValue.get(null)!;
    const ref = modelNameSchema.parse(value);
    return byValue.get(ref) ?? {
      primaryKey: ref, value: ref, label: ref, unavailable: { reason: tForLocale(locale, "panels.agentOptions.unavailable") },
    };
  }) };
}

export function createModelOptionPanelReadPresenter(locale?: string) {
  return {
    options(payload: unknown) { return { options: presentDomainModelOptions(payload, locale) }; },
    resolve(payload: unknown, { values }: { values?: unknown }) {
      return resolveModelChoices(presentDomainModelOptions(payload, locale), values as readonly unknown[], locale);
    },
  };
}

const executionUserId = agentExecutionOptionsSchema.shape.users.element.shape.id;
const executionSelectionSchema = agentExecutionOptionsSchema.shape.selected.unwrap();

function executionOwnOption(locale?: string): PanelOption {
  return { primaryKey: "@default", value: null, label: tForLocale(locale, "panels.agentOptions.executionOwn") };
}

function presentExecutionUserOptions(users: AgentExecutionOptions["users"], pageNum: number, locale?: string) {
  const members = users.map(({ id, name }): PanelOption => ({ primaryKey: id, value: id, label: name }));
  // The empty choice heads the first page only, as every page after it continues the same list.
  return { options: pageNum === 1 ? [executionOwnOption(locale), ...members] : members };
}

function presentExecutionUserSelection(selected: z.infer<typeof executionSelectionSchema>, locale?: string): PanelOption {
  return {
    primaryKey: selected.id, value: selected.id, label: selected.name,
    ...(!selected.available && {
      unavailable: { reason: tForLocale(locale, `panels.agentOptions.${selected.reason ?? "unavailable"}`) },
    }),
  };
}

function executionUserPage(keyword?: string, page?: { number: number; size: number }) {
  return {
    ...(keyword !== undefined && { keyword }),
    ...(page && { pageNum: page.number, pageSize: page.size }),
  };
}

export function prepareExecutionUserRead(selection: PanelReadSelection, params: Record<string, unknown>, locale?: string) {
  if (selection.typeId !== USER) return;
  if (selection.method === "options") {
    const page = executionUserPage(panelReadParameterSchemas.keyword.optional().parse(params.keyword),
      panelReadParameterSchemas.page.optional().parse(params.page));
    return {
      call: { type: USER, name: "options", parameters: page },
      present: (payload: unknown) => presentExecutionUserOptions(agentExecutionOptionsSchema.shape.users.parse(payload), page.pageNum ?? 1, locale),
    };
  }
  if (selection.method === "resolve") {
    const values = z.array(executionUserId.nullable()).parse(params.values);
    const ids = values.filter(id => id !== null);
    return {
      call: { type: USER, name: "resolve", parameters: { ids } },
      present(payload: unknown) {
        const selections = z.array(executionSelectionSchema).length(ids.length).parse(payload);
        let index = 0;
        return { options: values.map(value => value === null ? executionOwnOption(locale)
          : presentExecutionUserSelection(selections[index++], locale)) };
      },
    };
  }
}

export function createAgentOptionReadAdapters(viewer: AssistantCredentials) {
  const modelOptions = () => readDomainModelOptions(viewer);
  return {
    models: {
      async options() { return { options: await modelOptions() }; },
      async resolve(values: readonly unknown[]) { return resolveModelChoices(await modelOptions(), values, viewer.locale); },
    },
    users: {
      async options({ keyword, page }: { keyword?: string; page?: { number: number; size: number } }) {
        const parameters = executionUserPage(keyword, page);
        const query = new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)]));
        const { users } = await queryExecutionOptions(viewer, query);
        return presentExecutionUserOptions(users, parameters.pageNum ?? 1, viewer.locale);
      },
      async resolve(values: readonly unknown[]) {
        return { options: await Promise.all(values.map(async (value): Promise<PanelOption> => {
          if (value === null) return executionOwnOption(viewer.locale);
          const id = executionUserId.parse(value);
          const { selected } = await queryExecutionOptions(viewer, new URLSearchParams({ selected: id, pageSize: "1" }));
          if (!selected) throw new Error("The execution user owner did not return the requested selection");
          return presentExecutionUserSelection(selected, viewer.locale);
        })) };
      },
    },
  };
}
