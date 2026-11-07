import { createApp, h, nextTick } from "vue";
import { expect, it, vi } from "vitest";
import ShellNavBody from "../components/ShellNavBody.vue";
import type { ShellLabels } from "../types";

it("offers rename and confirmed delete from the recent conversation menu", async () => {
  const rename = vi.fn(), remove = vi.fn();
  const root = document.createElement("div"); document.body.append(root);
  const app = createApp({ render: () => h(ShellNavBody, {
    title: "Agent", workbench: { id: "agents", label: "Agent", features: [] },
    agents: [], agentId: null, sessionsState: "ready", hasMore: false, sessionId: null, featureId: null,
    sessions: [{ id: "session", agentId: "agent", title: "Before", createdAt: "", updatedAt: "", latestRun: null }],
    labels: { more: "More", renameSession: "Rename", deleteSession: "Delete", deleteConfirm: "Delete?", cancel: "Cancel" } as ShellLabels,
    onRenameSession: rename, onDeleteSession: remove,
  }) });
  app.mount(root);
  try {
    root.querySelector<HTMLButtonElement>(".session-more")!.click(); await nextTick();
    root.querySelector<HTMLButtonElement>(".session-menu button")!.click(); await nextTick();
    const input = root.querySelector<HTMLInputElement>(".rename-dialog input")!;
    input.value = "After"; input.dispatchEvent(new Event("input"));
    await nextTick();
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(rename).toHaveBeenCalledWith("session", "After");
    await nextTick();
    root.querySelector<HTMLButtonElement>(".session-more")!.click(); await nextTick();
    root.querySelector<HTMLButtonElement>(".session-delete")!.click(); await nextTick();
    expect(remove).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".session-delete")!.click();
    expect(remove).toHaveBeenCalledWith("session");
  } finally { app.unmount(); root.remove(); }
});
