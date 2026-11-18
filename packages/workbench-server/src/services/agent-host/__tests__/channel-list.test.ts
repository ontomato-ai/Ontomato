import { configureI18n } from "../../../i18n";
import { en,enLocaleMeta } from "../../../i18n/locales/en";
import { beforeEach,expect,it,vi } from "vitest";
import { agentChannelService } from "../channel";
import { restoreAgentCaller } from "../caller";
import { assistantStore } from "../../assistant/store";
import { diagnosisService } from "../../ops-diagnosis/service";
import { workbenchIdentity } from "../../../identity/installed";
import { HttpError } from "../../../utils/errors";
vi.mock("../../assistant/skills",()=>({needsRetrievalScope:()=>false}));
vi.mock("../caller",() => ({ restoreAgentCaller: vi.fn() }));
vi.mock("../../assistant/service",() => ({ assistantService: { admitAgent: vi.fn() } }));
vi.mock("../../assistant/store",() => ({ assistantStore: { channelAgents: vi.fn() } }));
vi.mock("../../ops-diagnosis/service",() => ({ diagnosisService: { agents: vi.fn() },createDiagnosis: vi.fn(),prepareDiagnosis: vi.fn() }));
vi.mock("../../../identity/installed",() => ({ workbenchIdentity: vi.fn() }));
configureI18n({defaultLocale:"en",appTextLocale:"en",languageSwitchEnabled:true,packs:{
  en:{messages:en,...enLocaleMeta},
  "zh-CN":{messages:{...en,"assistant.default.regular.name":"智能助手","assistant.default.regular.description":"业务数据助手"},...enLocaleMeta},
}});
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
  const result = await agentChannelService.list({ providerId: "workbench",actor,language:"en" },"a");
  expect(result.agents.map(agent => agent.ref.providerId)).toEqual(["workbench"]);
  expect(observeAccess).not.toHaveBeenCalled();
  expect(diagnosisService.agents).not.toHaveBeenCalled();
});
it("the diagnosis provider lists only its own agents",async () => {
  const result = await agentChannelService.list({ providerId: "observe",actor,language:"en" },"a");
  expect(result.agents.map(agent => agent.ref.providerId)).toEqual(["observe"]);
  expect(assistantStore.channelAgents).not.toHaveBeenCalled();
  expect(observeAccess).toHaveBeenCalledTimes(1);
});
it("a denied diagnosis capability contributes no entries",async () => {
  observeAccess.mockRejectedValue(new HttpError(403,"Forbidden","FORBIDDEN"));
  await expect(agentChannelService.list({ providerId: "observe",actor,language:"en" },"a")).resolves.toEqual({ agents: [] });
  expect(diagnosisService.agents).not.toHaveBeenCalled();
});

it("uses the caller locale with the workbench's existing default label owner",async()=>{
  vi.mocked(assistantStore.channelAgents).mockResolvedValue([{id:actor.id,kind:"regular",name:"Assistant",description:"Ask questions about your data",enabled:true} as Awaited<ReturnType<typeof assistantStore.channelAgents>>[number]]);
  const result=await agentChannelService.list({providerId:"workbench",actor,language:"zh-CN"},"a");
  expect(result.agents[0]).toMatchObject({name:"智能助手",description:"业务数据助手"});
});
it("passes the caller locale to the diagnosis provider's own labels",async()=>{
  await agentChannelService.list({providerId:"observe",actor,language:"zh-CN"},"a");
  expect(diagnosisService.agents).toHaveBeenCalledWith({userId:"user",domainId:"a"},"zh-CN");
});
