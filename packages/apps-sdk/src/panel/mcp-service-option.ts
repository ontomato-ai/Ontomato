import { mcpServiceOptionsSchema } from "@ontomato/contracts/agent-runtime-mcp";
import { runtimeIdSchema } from "@ontomato/contracts/agent-runtime-values";
import { MCP_SERVICE_OPTION } from "@ontomato/contracts/panel-client-requests";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

export const mcpServiceOptionAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    const response = await requests.request("/mcp/services/names", {}, "");
    return mcpServiceOptionsSchema.parse(await response.json())
      .map(({ id, name }) => ({ primaryKey: id, label: name, value: id }));
  }
  return [{
    objectType: MCP_SERVICE_OPTION,
    options: {
      async list() { return { options: await list() }; },
      async resolve(values) {
        const options = new Map((await list()).map(option => [option.primaryKey, option]));
        return values.map(value => {
          const id = runtimeIdSchema.parse(value);
          return options.get(id) ?? { primaryKey: id, value: id, label: id, unavailable: { reason: "assistant.unavailable" } };
        });
      },
    },
  }];
};
