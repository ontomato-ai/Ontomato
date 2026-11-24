import { mcpServiceOptionsSchema } from "@ontomato/contracts/agent-runtime-mcp";
import { runtimeIdSchema } from "@ontomato/contracts/agent-runtime-values";
import { EXTERNAL_MCP_SERVICE } from "@ontomato/contracts/panel-client-requests";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

export const externalMcpServiceAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    const response = await requests.request("/mcp/services/names", {}, "");
    return mcpServiceOptionsSchema.parse(await response.json())
      .map(({ id, name }) => ({ primaryKey: id, label: name, value: id }));
  }
  return [{
    objectType: EXTERNAL_MCP_SERVICE,
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
