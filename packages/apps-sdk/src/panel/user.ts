import { agentExecutionOptionsSchema } from "@ontomato/contracts/assistant-chat";
import { USER } from "@ontomato/contracts/panel-client-requests";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

const memberId = agentExecutionOptionsSchema.shape.users.element.shape.id;
const withSelected = agentExecutionOptionsSchema.required({ selected: true });

export const userAdapters: PlatformObjectAdapterFactory = requests => {
  async function read(query: URLSearchParams) {
    const response = await requests.request(`/platform/agent-execution/options?${query}`, {}, "/data-query");
    return response.json();
  }
  return [{
    objectType: USER,
    options: {
      async list({ keyword = "", page = { number: 1, size: 20 } }) {
        const query = new URLSearchParams({ keyword, pageNum: String(page.number), pageSize: String(page.size) });
        const { users } = agentExecutionOptionsSchema.parse(await read(query));
        return { options: users.map(({ id, name }) => ({ primaryKey: id, label: name, value: id })) };
      },
      resolve(values) {
        return Promise.all(values.filter(value => value !== null).map(async value => {
          const selectedId = memberId.parse(value);
          const query = new URLSearchParams({ selected: selectedId, pageSize: "1" });
          const { selected } = withSelected.parse(await read(query));
          return {
            primaryKey: selected.id, label: selected.name, value: selected.id,
            ...(selected.available ? {} : { unavailable: { reason: selected.reason ?? "unavailable" } }),
          };
        }));
      },
    },
  }];
};
