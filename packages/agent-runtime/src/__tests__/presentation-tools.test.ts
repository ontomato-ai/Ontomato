import { describe, expect, it, vi } from "vitest";
import { createPresentationBatchController, createPresentationTools } from "../runtime";

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
    const fillForm = tools.find((tool) => tool.name === "fill_form")!;
    const pageAction = tools.find((tool) => tool.name === "page_action")!;
    const fillProps = Object.keys((fillForm.parameters as { properties: Record<string, unknown> }).properties);
    const actionProps = Object.keys((pageAction.parameters as { properties: Record<string, unknown> }).properties);

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
    const present = tools.find((t) => t.name === "present")!;
    const fillForm = tools.find((t) => t.name === "fill_form")!;

    const first = present.execute("call-1", { target: "/applications/crm/contacts" }, undefined);
    const second = fillForm.execute("call-2", { member: "form", values: { "/name": "Alice" } }, undefined);

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
    const present = tools.find((t) => t.name === "present")!;
    const fillForm = tools.find((t) => t.name === "fill_form")!;
    const pageAction = tools.find((t) => t.name === "page_action")!;

    const r1 = await present.execute("c1", { target: "/applications/crm/other" }, undefined);
    const r2 = await fillForm.execute("c2", { member: "form", values: { "/name": "Bob" } }, undefined);
    const r3 = await pageAction.execute("c3", { operation: "form.save" }, undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((r1.content[0] as { text: string }).text)).toMatchObject({ status: "not_opened", reason: "blocked_unsaved" });
    expect(JSON.parse((r2.content[0] as { text: string }).text)).toMatchObject({
      status: "not_filled",
      reason: "previous_step_failed",
      member: "form",
    });
    expect(JSON.parse((r3.content[0] as { text: string }).text)).toMatchObject({
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
    const r4 = await fillForm.execute("c4", { member: "form", values: { "/name": "Carol" } }, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((r4.content[0] as { text: string }).text)).toMatchObject({ status: "filled" });
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
    const fillForm = tools.find((tool) => tool.name === "fill_form")!;
    const pageAction = tools.find((tool) => tool.name === "page_action")!;
    const values = rejectedFields?.length ? { "/name": "Bob", "/phoen": "123" } : { "/name": "Bob" };
    const [fill, save] = await Promise.all([
      fillForm.execute("fill", { member: "form", values }, undefined),
      pageAction.execute("save", { operation: "form.save" }, undefined),
    ]);

    expect(JSON.parse((fill.content[0] as { text: string }).text)).toEqual(receipt);
    const saveReceipt = JSON.parse((save.content[0] as { text: string }).text);
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
    const pageAction = tools.find((t) => t.name === "page_action")!;
    const present = tools.find((t) => t.name === "present")!;

    await pageAction.execute("c1", { operation: "form.save" }, undefined);
    const skippedAfterConfirm = await present.execute("c2", { target: "/applications/crm/next" }, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((skippedAfterConfirm.content[0] as { text: string }).text)).toMatchObject({
      status: "not_opened",
      reason: "previous_step_failed",
    });

    batch.reset();
    await expect(pageAction.execute("c3", { operation: "form.save" }, undefined)).rejects.toThrow("network boom");
    const skippedAfterThrow = await pageAction.execute("c4", { operation: "remove.delete" }, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((skippedAfterThrow.content[0] as { text: string }).text)).toMatchObject({
      status: "not_executed",
      reason: "previous_step_failed",
      operation: "remove.delete",
    });
  });
});
