import { describe, expect, it, vi } from "vitest";
import { createPresentationBatchController, createPresentationTools } from "../platform-tools";

const callback = {
  url: "http://127.0.0.1:4000/api/assistant/sessions/s1/runs/r1/presentation-call/v1",
  credential: "cred-1",
};

const samplePageSnapshot = {
  known: true,
  observedAt: "2026-11-24T00:00:00.000Z",
  placement: "side",
  target: {
    kind: "page",
    url: "/applications/crm/contacts",
    label: "Contacts",
    selection: [],
    pageInstanceId: "page-1",
  },
  load: { status: "ready" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("presentation tools schema & same-batch sequential early-stop", () => {
  it("does not expose expected* basis parameters on fill_form or page_action tool schemas", () => {
    const tools = createPresentationTools("r1", callback);
    const fillForm = tools.find((tool) => tool.declaration.name === "fill_form")!;
    const pageAction = tools.find((tool) => tool.declaration.name === "page_action")!;
    const fillProps = Object.keys((fillForm.declaration.parameters as { properties: Record<string, unknown> }).properties);
    const actionProps = Object.keys((pageAction.declaration.parameters as { properties: Record<string, unknown> }).properties);

    for (const forbidden of [
      "expectedPageInstanceId",
      "expectedPanelInstanceId",
      "expectedMemberInstanceId",
      "expectedFormInstanceId",
      "expectedEntryInstanceId",
      "expectedTarget",
      "expectedCheckedKeys",
      "expectedDashboardId",
      "expectedCardId",
    ]) {
      expect(fillProps).not.toContain(forbidden);
      expect(actionProps).not.toContain(forbidden);
    }
    expect(fillForm.executionMode).toBe("sequential");
    expect(pageAction.executionMode).toBe("sequential");
  });

  it("serializes same-batch calls so step 2 waits for step 1 to finish before sending its request", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const payload = JSON.parse(String(init?.body)) as { toolCallId: string };
      events.push(`start:${payload.toolCallId}`);
      if (payload.toolCallId === "call-1") {
        await firstGate;
        events.push(`end:${payload.toolCallId}`);
        return jsonResponse({ status: "opened", reason: "target_selected", current: samplePageSnapshot });
      }
      events.push(`end:${payload.toolCallId}`);
      return jsonResponse({
        status: "filled",
        reason: "form_updated",
        member: "form",
        filledFields: ["/name"],
        current: samplePageSnapshot,
      });
    });

    const batch = createPresentationBatchController();
    const tools = createPresentationTools("r1", callback, batch, fetchMock as unknown as typeof fetch);
    const present = tools.find((t) => t.declaration.name === "present")!;
    const fillForm = tools.find((t) => t.declaration.name === "fill_form")!;
    const signal = new AbortController().signal;

    const first = present.execute({
      toolCallId: "call-1",
      toolName: "present",
      args: { target: "/applications/crm/contacts" },
      signal,
    });
    const second = fillForm.execute({
      toolCallId: "call-2",
      toolName: "fill_form",
      args: { member: "form", values: { "/name": "Alice" } },
      signal,
    });

    await vi.waitFor(() => expect(events).toEqual(["start:call-1"]));
    releaseFirst();

    await Promise.all([first, second]);
    expect(events).toEqual(["start:call-1", "end:call-1", "start:call-2", "end:call-2"]);
  });

  it("skips subsequent calls in the same batch when present fails and resets on the next assistant turn", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: "not_opened",
        reason: "blocked_unsaved",
        current: samplePageSnapshot,
      }),
    );

    const batch = createPresentationBatchController();
    const turn1 = { role: "assistant" };
    batch.beginTurn(turn1);
    const tools = createPresentationTools("r1", callback, batch, fetchMock as unknown as typeof fetch);
    const present = tools.find((t) => t.declaration.name === "present")!;
    const fillForm = tools.find((t) => t.declaration.name === "fill_form")!;
    const pageAction = tools.find((t) => t.declaration.name === "page_action")!;
    const signal = new AbortController().signal;

    const r1 = await present.execute({
      toolCallId: "c1",
      toolName: "present",
      args: { target: "/applications/crm/other" },
      signal,
    });
    const r2 = await fillForm.execute({
      toolCallId: "c2",
      toolName: "fill_form",
      args: { member: "form", values: { "/name": "Bob" } },
      signal,
    });
    const r3 = await pageAction.execute({
      toolCallId: "c3",
      toolName: "page_action",
      args: { operation: "form.save" },
      signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((r1.result.content[0] as { text: string }).text)).toMatchObject({ status: "not_opened", reason: "blocked_unsaved" });
    expect(JSON.parse((r2.result.content[0] as { text: string }).text)).toMatchObject({
      status: "not_filled",
      reason: "previous_step_failed",
      member: "form",
    });
    expect(JSON.parse((r3.result.content[0] as { text: string }).text)).toMatchObject({
      status: "not_executed",
      reason: "previous_step_failed",
      operation: "form.save",
    });

    // Next assistant turn clears the batch failure state.
    const turn2 = { role: "assistant" };
    batch.beginTurn(turn2);
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: "filled",
      reason: "form_updated",
      member: "form",
      filledFields: ["/name"],
      current: samplePageSnapshot,
    }));
    const r4 = await fillForm.execute({
      toolCallId: "c4",
      toolName: "fill_form",
      args: { member: "form", values: { "/name": "Carol" } },
      signal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((r4.result.content[0] as { text: string }).text)).toMatchObject({ status: "filled" });
  });

  it.each([
    { outcome: "partially rejected", rejectedFields: [{ path: "/phoen", reason: "unknown_field", message: "Unknown field" }] },
    { outcome: "fully filled", rejectedFields: undefined },
    { outcome: "fully filled with an empty rejection list", rejectedFields: [] },
  ])("handles save in the same batch after a $outcome form fill", async ({ rejectedFields }) => {
    const receipt = {
      status: "filled",
      reason: "form_updated",
      member: "form",
      filledFields: ["/name"],
      ...(rejectedFields === undefined ? {} : { rejectedFields }),
      current: samplePageSnapshot,
    };
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(receipt))
      .mockResolvedValueOnce(jsonResponse({
        status: "executed", reason: "action_completed", operation: "form.save", current: samplePageSnapshot,
      }));
    const tools = createPresentationTools("r1", callback, createPresentationBatchController(), fetchMock);
    const fillForm = tools.find((tool) => tool.declaration.name === "fill_form")!;
    const pageAction = tools.find((tool) => tool.declaration.name === "page_action")!;
    const signal = new AbortController().signal;
    const values: Record<string, string> = rejectedFields?.length ? { "/name": "Bob", "/phoen": "123" } : { "/name": "Bob" };
    const [fill, save] = await Promise.all([
      fillForm.execute({ toolCallId: "fill", toolName: "fill_form", args: { member: "form", values }, signal }),
      pageAction.execute({ toolCallId: "save", toolName: "page_action", args: { operation: "form.save" }, signal }),
    ]);

    expect(JSON.parse((fill.result.content[0] as { text: string }).text)).toEqual(receipt);
    const saveReceipt = JSON.parse((save.result.content[0] as { text: string }).text);
    if (rejectedFields?.length) {
      expect(saveReceipt).toMatchObject({
        status: "not_executed",
        reason: "previous_step_failed",
        error: { code: "PREVIOUS_STEP_FAILED", message: expect.stringContaining("/phoen") },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } else {
      expect(saveReceipt).toMatchObject({ status: "executed", operation: "form.save" });
      expect(fetchMock.mock.calls.map(([, request]) => JSON.parse(request!.body as string).toolCallId))
        .toEqual(["fill", "save"]);
    }
  });

  it("stops the batch when page_action returns awaiting_confirmation, unknown, or throws", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "awaiting_confirmation",
        reason: "confirmation_required",
        operation: "form.save",
        intentId: "00000000-0000-4000-8000-000000000001",
        questionId: "00000000-0000-4000-8000-000000000002",
        label: "Save",
        current: samplePageSnapshot,
      }))
      .mockRejectedValueOnce(new Error("network boom"));

    const batch = createPresentationBatchController();
    const tools = createPresentationTools("r1", callback, batch, fetchMock as unknown as typeof fetch);
    const pageAction = tools.find((t) => t.declaration.name === "page_action")!;
    const present = tools.find((t) => t.declaration.name === "present")!;
    const signal = new AbortController().signal;

    await pageAction.execute({
      toolCallId: "c1",
      toolName: "page_action",
      args: { operation: "form.save" },
      signal,
    });
    const skippedAfterConfirm = await present.execute({
      toolCallId: "c2",
      toolName: "present",
      args: { target: "/applications/crm/next" },
      signal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((skippedAfterConfirm.result.content[0] as { text: string }).text)).toMatchObject({
      status: "not_opened",
      reason: "previous_step_failed",
    });

    batch.reset();
    await expect(
      pageAction.execute({
        toolCallId: "c3",
        toolName: "page_action",
        args: { operation: "form.save" },
        signal,
      }),
    ).rejects.toThrow("network boom");
    const skippedAfterThrow = await pageAction.execute({
      toolCallId: "c4",
      toolName: "page_action",
      args: { operation: "remove.delete" },
      signal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((skippedAfterThrow.result.content[0] as { text: string }).text)).toMatchObject({
      status: "not_executed",
      reason: "previous_step_failed",
      operation: "remove.delete",
    });
  });
});
