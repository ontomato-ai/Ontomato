import { agentExecutionOptionsSchema } from "@ontomato/contracts/assistant-chat";
import { modelNameSchema } from "@ontomato/contracts/model-settings";
import type { PanelOption } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { queryExecutionOptions } from "./execution-setting";
import { readDomainModelOptions } from "./model-panel-form";

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
          const ref = modelNameSchema.parse(value);
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
