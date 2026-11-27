import { expect, it, vi } from "vitest";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { agentChannelService } from "../channel";
import { createDiagnosis, prepareDiagnosis } from "../../ops-diagnosis/service";
import { restoreAgentCaller } from "../caller";

/** The legacy diagnosis provider's /prepare passes on only the execution account a preview's run is bound to, and returns what it ran as. */
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../caller", () => ({ restoreAgentCaller: vi.fn() }));
vi.mock("../presentation", async original => ({
  ...await original<typeof import("../presentation")>(), presentationCallback: () => undefined,
}));
vi.mock("../../ops-diagnosis/service", async original => ({
  ...await original<typeof import("../../ops-diagnosis/service")>(),
  createDiagnosis: vi.fn(async () => ({})),
  prepareDiagnosis: vi.fn(),
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const actor = { id: "33333333-3333-4333-8333-333333333333", domainId: "domain" };
const owner = { domainId: "domain", userId: "user" };

it.each([
  { kind: "preview" as const, executionActor: { userId: "executor", domainId: "domain" }, passed: { userId: "executor", domainId: "domain" } },
  { kind: "preview" as const, executionActor: null, passed: null },
  { kind: "live" as const, executionActor: { userId: "parent-account", domainId: "domain" }, passed: undefined },
  { kind: "live" as const, executionActor: null, passed: undefined },
])("hands a $kind diagnosis run only the account a preview is bound to", async ({ kind, executionActor, passed }) => {
  vi.mocked(restoreAgentCaller).mockResolvedValue({ owner, credentials: { token: "tok" }, expiresAt: Date.now() + 60_000 } as never);
  const started = { language: "en", input: { role: "user", content: "Check", timestamp: 1 },
    definition: { sandbox: { limits: { wallTimeMs: 60_000 } } }, executionActor: passed ?? null };
  vi.mocked(prepareDiagnosis).mockResolvedValue(started as never);
  const authority = { classNames: [], executionKind: kind };
  const prepared = await agentChannelService.prepare({
    mode: "run", language: "en", agent: { providerId: "observe", agentId: DIAGNOSIS_AGENT_ID }, sessionId, runId, actor,
    executionActor, inputId: runId, input: { role: "user", content: "Check", timestamp: 1 }, authority, requestedBy: null,
    root: { session: { providerId: "observe", sessionId }, runId }, userRecipient: null,
  }, "domain", { token: "tok" });
  expect(createDiagnosis).toHaveBeenCalled();
  // A live diagnosis runs as its initiator whatever account its delegating run had, as before.
  expect(vi.mocked(prepareDiagnosis).mock.calls.at(-1)!.slice(6)).toEqual([authority, passed]);
  expect(prepared).toMatchObject({ executionActor: started.executionActor });
});
