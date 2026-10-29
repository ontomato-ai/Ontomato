import { beforeEach, describe, expect, it, vi } from "vitest";
import { sealModelKey } from "@ontomato/contracts/model-key-seal";
import { MODEL_ROLES, type ModelSettingsServerData } from "@ontomato/contracts/model-settings";
import { runWithLogContext } from "../../logging/log-context";
import { ModelNotConfiguredError, resolveModelForRole } from "../model-resolver";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    constructor(readonly domainId: string) {}
    modelSettings() { return read(this.domainId); }
  },
}));
vi.mock("../../i18n", () => ({ t: (key: string) => key }));
const settings = (): ModelSettingsServerData => ({
  models: [{ name: "main", displayName: "Main", baseUrl: "https://model.invalid/v1", modelName: "model",
    apiKeys: ["******1234"], maxTokens: 4096, contextWindow: 32000, timeout: "PT30S" }],
  agents: Object.fromEntries(MODEL_ROLES.map(role => [role, { model: "main" }])) as ModelSettingsServerData["agents"],
  sealedApiKeys: { main: [sealModelKey("sk-fixture-key-1234", process.env.ONTOMATO_MODEL_RUNTIME_TOKEN)] },
});
describe("runtime model resolver", () => {
  beforeEach(() => { read.mockReset(); });
  it("uses the verified domain and locally opens only sealed keys", async () => {
    read.mockResolvedValue(settings());
    const resolved = await runWithLogContext({ domainId: "d1", token: "end-user" }, () => resolveModelForRole());
    expect(read).toHaveBeenCalledWith("d1");
    expect(resolved).toMatchObject({ apiKey: "sk-fixture-key-1234", modelName: "model", timeoutSeconds: 30 });
  });
  it("does not resolve an unassigned role through a different role", async () => {
    const data = settings(); data.agents.general.model = null; read.mockResolvedValue(data);
    await expect(runWithLogContext({ domainId: "d1" }, () => resolveModelForRole())).rejects.toThrow(ModelNotConfiguredError);
  });
  it("preserves runtime read failures and refuses a missing domain", async () => {
    read.mockRejectedValue(new Error("runtime unavailable"));
    await expect(runWithLogContext({ domainId: "d1" }, () => resolveModelForRole())).rejects.toThrow("runtime unavailable");
    await expect(runWithLogContext({ domainId: undefined }, () => resolveModelForRole())).rejects.toThrow("verified domain");
  });
});
