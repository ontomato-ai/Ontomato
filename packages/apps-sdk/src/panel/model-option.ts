import { modelOptionsSchema, modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { MODEL_OPTION } from "@ontomato/contracts/panel-client-requests";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

export const modelOptionAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    const response = await requests.request("/model-options", {}, "/data-query");
    const { models } = modelOptionsSchema.parse((await response.json()).data);
    return models.filter(model => model.type === "chat").map(model => ({
      primaryKey: model.ref, label: model.name, value: model.ref,
    }));
  }
  return [{
    objectType: MODEL_OPTION,
    options: {
      async list() { return { options: await list() }; },
      async resolve(values) {
        const options = new Map((await list()).map(option => [option.primaryKey, option]));
        return values.map(value => {
          if (value === null) return { primaryKey: "", value, label: "agents.useDomainDefault" };
          const id = modelReferenceSchema.parse(value);
          return options.get(id) ?? { primaryKey: id, value: id, label: id, unavailable: { reason: "assistant.unavailable" } };
        });
      },
    },
  }];
};
