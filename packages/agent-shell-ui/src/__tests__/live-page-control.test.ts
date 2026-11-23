import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { pageContextLine, writtenText } from "../page-context";
import { useConversationDisplay, type DisplayPage, type DisplayView } from "../conversation-display";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function frame(target: PresentationFrame["target"]): PresentationFrame {
  return { type: "presentation", sessionId: SESSION, runId: RUN, toolCallId: `call-${Math.random()}`, target };
}

function setup(options: {
  admit?: Parameters<typeof useConversationDisplay>[0]["admit"];
  initial?: { page: DisplayPage; view: DisplayView };
} = {}) {
  const serialized: { page: DisplayPage | null; view: DisplayView; history: string }[] = [];
  const pages: Record<string, string> = {
    "/actions": "Actions",
    "/graph": "Ontology Graph",
    "/admin/users": "Users",
  };
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Panel", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path in pages ? { featureId: "panel", address, instance: path } : null;
    },
    ...(options.admit ? { admit: options.admit } : {}),
    serialize: async (page, view, history) => {
      serialized.push({ page, view, history });
      return true;
    },
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || pages[page.instance] || "",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
    ...(options.initial ? { initial: options.initial } : {}),
  });
  display.placed(() => "side");
  return { display, serialized };
}

describe("live agent page control (requirement-64995244)", () => {
  it("preserves all three layout states (none -> side, side -> side, full -> full) and writes navigation to address", async () => {
    // 1. Conversation only -> opens in side-by-side and writes to address.
    const { display, serialized } = setup();
    expect(display.target.value).toBeNull();
    const opened = await display.present(frame({ kind: "page", address: "/actions" }));
    expect(opened).toMatchObject({ status: "opened", reason: "target_selected" });
    expect(display.view.value).toBe("side");
    expect(display.restorable.value).toBe(true);
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/actions" }, view: "side", history: "push" });

    // 2. Already side-by-side -> stays side-by-side when switching pages.
    await display.present(frame({ kind: "page", address: "/graph" }));
    expect(display.view.value).toBe("side");
    expect(display.page.value?.address).toBe("/graph");
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/graph" }, view: "side", history: "push" });

    // 3. Already full-page -> stays full-page when switching pages (only user collapse returns to side).
    await display.setView("full");
    expect(display.view.value).toBe("full");
    await display.present(frame({ kind: "page", address: "/actions" }));
    expect(display.view.value).toBe("full");
    expect(display.page.value?.address).toBe("/actions");
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/actions" }, view: "full", history: "push" });
  });

  it("rejects unauthorized entries without opening or replacing the right pane and returns the refusal reason", async () => {
    const admit = vi.fn(async (address: string) =>
      address.startsWith("/admin/")
        ? { ok: false as const, reason: "forbidden" as const, error: { code: "FORBIDDEN", message: "No access to Users" } }
        : { ok: true as const },
    );
    const { display, serialized } = setup({ admit });
    await display.present(frame({ kind: "page", address: "/actions" }));
    const beforeWrites = serialized.length;

    const denied = await display.present(frame({ kind: "page", address: "/admin/users" }));
    expect(denied).toMatchObject({
      status: "not_opened",
      reason: "forbidden",
      error: { code: "FORBIDDEN", message: "No access to Users" },
      current: { known: true, target: { kind: "page", url: "/actions" } },
    });
    expect(display.page.value?.address).toBe("/actions");
    expect(serialized).toHaveLength(beforeWrites);
  });

  it("updates non-deepLink declared public state in place without reloading and returns updated public state in receipt", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const liveValues: Record<string, unknown> = { activeTab: "definition", keyword: "", checked: [] };
    display.context({ url: "/actions", label: "Actions", selection: [], state: { ...liveValues } });

    const applyState = vi.fn((patch: Readonly<Record<string, unknown>>) => {
      Object.assign(liveValues, patch);
      display.context({ url: "/actions", label: "Actions", selection: [], state: { ...liveValues } });
    });
    const unregister = display.registerPageController("/actions", { applyState });

    const receipt = await display.present(frame({
      kind: "page",
      address: "/actions",
      state: { activeTab: "code", checked: [{ className: "platform:Action", primaryKey: "act-1" }] },
    }));
    expect(applyState).toHaveBeenCalledWith({
      activeTab: "code",
      checked: [{ className: "platform:Action", primaryKey: "act-1" }],
    });
    expect(receipt).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: {
        target: {
          kind: "page",
          url: "/actions",
          state: { activeTab: "code", keyword: "", checked: [{ className: "platform:Action", primaryKey: "act-1" }] },
        },
      },
    });
    unregister();
  });

  it("blocks draft fill on a dirty form without silently overwriting, and allows it only after overwriteUnsavedDraft: true", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    display.dirty(true);

    const applyAddress = vi.fn();
    const unregister = display.registerPageController("/actions", { applyState: vi.fn(), applyAddress });

    const draftAddress = "/actions?draftSessionId=s1&draftRunId=r1&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json";
    const blocked = await display.present(frame({ kind: "page", address: draftAddress }));
    expect(blocked).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      error: { code: "UNSAVED_FORM_CONFLICT" },
      current: { target: { kind: "page", url: "/actions" } },
    });
    expect(display.page.value?.address).toBe("/actions");
    expect(applyAddress).not.toHaveBeenCalled();

    // After user explicitly confirms in chat, agent calls present again with overwriteUnsavedDraft: true.
    const overwritten = await display.present(frame({ kind: "page", address: draftAddress, overwriteUnsavedDraft: true }));
    await nextTick();
    expect(overwritten).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: { target: { kind: "page", url: draftAddress } },
    });
    expect(applyAddress).toHaveBeenCalledWith(draftAddress, { overwriteUnsavedDraft: true });
    unregister();
  });

  it("carries declared public state on every user message even when the page address did not change", () => {
    const prompts = {
      page: (p: { label: string; url: string }) => `Current page: ${p.label} (${p.url})`,
      pageAddress: (url: string) => `Current page: ${url}`,
      selection: (s: string) => `Selected: ${s}`,
      state: (s: string) => `State: ${s}`,
      file: (f: { label: string; path: string }) => `Current file: ${f.label} (${f.path})`,
      closed: "Current page: closed",
    };
    const context = {
      url: "/graph",
      label: "Ontology Graph",
      selection: [],
      state: { filter: "relations", search: "order" },
    };
    const line = pageContextLine(context, prompts, false);
    expect(line).toBe('State: {"filter":"relations","search":"order"}');
    expect(writtenText(`What is shown here?\n\n${line}`, prompts)).toBe("What is shown here?");
  });
});
