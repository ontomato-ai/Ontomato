import { afterEach, expect, it, vi } from "vitest";
import { AgentChannel } from "../channel";
import type { AgentRuntime } from "../runtime";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { AgentNotification } from "@ontomato/contracts/agent-channel";
const sessionId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", inputId = "33333333-3333-4333-8333-333333333333";
const scope = { hostId: "test-host", domainId: "a" };
const source = { session: { providerId: "registered-custom", sessionId }, runId };
const context = { agent: { providerId: "registered-custom", agentId: "reviewer" }, actor: { id: runId, domainId: "a" }, authority: { classNames: ["Orders"], executionKind: "live" as const }, requestedBy: null, root: source };
const run = { id: runId, language: "en", sessionId, channel: context } as RuntimeRun;
const notification: AgentNotification = { role: "notification", kind: "agent-answer", replyTo: inputId, source, content: "Use the confirmed period", timestamp: 1 };
afterEach(() => { vi.unstubAllGlobals(); });
function channel() {
  let locked = false;
  const runtime = { options: { agentProviders: [{ id: "registered-custom", hostId: scope.hostId, url: "http://provider.test/channel", token: "service" }] }, store: { messages: vi.fn(async () => []) },
    locked: async (_scope: unknown, _session: unknown, fn: () => Promise<unknown>) => { locked = true; try { return await fn(); } finally { locked = false; } },
    seal: vi.fn(() => expect(locked).toBe(true)),
  } as unknown as AgentRuntime;
  const port = new AgentChannel(runtime);
  vi.spyOn(port.facts,"intent").mockResolvedValue({ id: runId, session: source.session, channel: context, inputId, status: "running", language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  return { runtime, channel: port, locked: () => locked };
}
it("seals under the consumption lock when the queue is empty", async () => {
  const { runtime, channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([]);
  expect(await port.followUp(scope, run)).toEqual([]);
  expect(runtime.seal).toHaveBeenCalledWith(scope, runId);
});
it("a registered provider sees typed inputs outside the lock; PI keeps their receipt identity", async () => {
  const { channel: port, locked } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, message: notification }]);
  const consume = vi.spyOn(port.facts, "consume").mockImplementation(async () => { expect(locked()).toBe(true); });
  const fetch = vi.fn(async (_url: unknown, init: { body?: string }) => {
    expect(locked()).toBe(false);
    expect(JSON.parse(init.body as string)).toMatchObject({ mode: "steer", input: notification, agent: context.agent, actor: context.actor });
    return Response.json({ accepted: true });
  });
  vi.stubGlobal("fetch", fetch);
  const [message] = await port.followUp(scope, run);
  expect(message).toBe(notification);
  expect(port.inputIds.get(message)).toBe(inputId);
  expect(consume).toHaveBeenCalledWith(scope, sessionId, runId, [inputId]);
  expect(fetch.mock.calls[0][0]).toBe("http://provider.test/channel/prepare");
});
it("does not turn a provider refusal into model input or an empty success", async () => {
  const { channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, message: notification }]);
  vi.spyOn(port.facts, "consume").mockResolvedValue();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "CALLER_EXPIRED", message: "Caller expired" } }, { status: 403 })));
  await expect(port.followUp(scope, run)).rejects.toMatchObject({ code: "CALLER_EXPIRED" });
});
it("rejects an unrelated recipient before receiving an input or calling a provider", async () => {
  const { channel: port } = channel();
  vi.spyOn(port.facts, "binding").mockResolvedValue({ agent: context.agent, actor: context.actor, parent: null });
  const receive = vi.spyOn(port.facts, "receive");
  await expect(port.execute(scope, run, { op: "send", session: source.session, message: "Do work" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(receive).not.toHaveBeenCalled();
});
it("a later parent run can read work its conversation delegated in an earlier run", async () => {
  const { channel: port } = channel();
  const child = { id: inputId, session: { providerId: source.session.providerId, sessionId: inputId }, channel: { ...context, root: { ...source,runId: "44444444-4444-4444-8444-444444444444" }, requestedBy: { ...source, runId: "44444444-4444-4444-8444-444444444444" } }, inputId, status: "completed" as const, language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false };
  vi.spyOn(port.facts, "intents").mockResolvedValue([{ scope,intent: child }]);
  vi.spyOn(port, "callback").mockResolvedValue({ status: "completed", summary: "Saved", process: { mode: "none" }, results: [] });
  await expect(port.execute(scope,run,{ op: "read",taskId: inputId })).resolves.toMatchObject({ taskId: inputId,status: "completed" });
});

it("message reads expose conversation progress without transferring the child's system prompt", async () => {
  const { runtime,channel: port } = channel();
  const child = { id: inputId, session: { providerId: source.session.providerId,sessionId: inputId },channel: { ...context,requestedBy: source },inputId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  vi.spyOn(port.facts,"intents").mockResolvedValue([{ scope,intent: child }]);
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [] });
  vi.spyOn(runtime.store,"messages").mockResolvedValue([
    { id: runId,runId: inputId,messageSeq: 1,message: { role: "system",content: "Private host instructions",timestamp: 1 } },
    { id: inputId,runId: inputId,messageSeq: 2,message: notification },
  ]);
  const result = await port.execute(scope,run,{ op: "read",taskId: inputId,view: "messages" }) as { messages: Array<{ id: string }> };
  expect(result.messages.map(message => message.id)).toEqual([inputId]);
});
