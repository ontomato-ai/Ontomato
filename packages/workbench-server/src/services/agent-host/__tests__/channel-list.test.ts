import { beforeEach,expect,it,vi } from "vitest";
import { agentChannelService } from "../channel";
import { restoreAgentCaller } from "../caller";
import { assistantStore } from "../../assistant/store";
import { diagnosisService } from "../../ops-diagnosis/service";
import { workbenchIdentity } from "../../../identity/installed";
import { HttpError } from "../../../utils/errors";
vi.mock("../caller",() => ({ restoreAgentCaller: vi.fn() }));
vi.mock("../../assistant/service",() => ({ assistantService: { admitAgent: vi.fn() } }));
vi.mock("../../assistant/store",() => ({ assistantStore: { channelAgents: vi.fn() } }));
vi.mock("../../ops-diagnosis/service",() => ({ diagnosisService: { agents: vi.fn() },createDiagnosis: vi.fn(),prepareDiagnosis: vi.fn() }));
vi.mock("../../../identity/installed",() => ({ workbenchIdentity: vi.fn() }));
const actor = { id: "11111111-1111-4111-8111-111111111111",domainId: "a" };
const observeAccess = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  observeAccess.mockReset();
  vi.mocked(restoreAgentCaller).mockResolvedValue({ owner: { userId: "user",domainId: "a" },credentials: { apiKey: "initiating-key" },expiresAt: 1000 });
  vi.mocked(workbenchIdentity).mockReturnValue({ assertObserveAccess: observeAccess } as unknown as ReturnType<typeof workbenchIdentity>);
  vi.mocked(assistantStore.channelAgents).mockResolvedValue([{ id: actor.id,name: "Assistant",description: "Help",enabled: true,kind: "regular" } as Awaited<ReturnType<typeof assistantStore.channelAgents>>[number]]);
  vi.mocked(diagnosisService.agents).mockResolvedValue({ agents: [{ id: actor.id,name: "Diagnosis",description: "Inspect",icon: null,enabled: true }] });
});
it("the workbench provider lists only its own agents",async () => {
  const result = await agentChannelService.list({ providerId: "workbench",actor },"a");
  expect(result.agents.map(agent => agent.ref.providerId)).toEqual(["workbench"]);
  expect(observeAccess).not.toHaveBeenCalled();
  expect(diagnosisService.agents).not.toHaveBeenCalled();
});
it("the diagnosis provider lists only its own agents",async () => {
  const result = await agentChannelService.list({ providerId: "observe",actor },"a");
  expect(result.agents.map(agent => agent.ref.providerId)).toEqual(["observe"]);
  expect(assistantStore.channelAgents).not.toHaveBeenCalled();
  expect(observeAccess).toHaveBeenCalledTimes(1);
});
it("a denied diagnosis capability contributes no entries",async () => {
  observeAccess.mockRejectedValue(new HttpError(403,"Forbidden","FORBIDDEN"));
  await expect(agentChannelService.list({ providerId: "observe",actor },"a")).resolves.toEqual({ agents: [] });
  expect(diagnosisService.agents).not.toHaveBeenCalled();
});
