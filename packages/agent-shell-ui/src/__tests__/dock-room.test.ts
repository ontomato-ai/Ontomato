import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App, type Ref } from "vue";
import ShellDockRoom from "../components/ShellDockRoom.vue";
import { pageDockSpaceKey } from "../context";

/*
 * The room the composer covers at the foot of a full page (packages/contracts/agent-shell.md "Declarations"): the shell
 * measures it once and a page says only where its content ends. `ShellDockRoom` is the form for a place a stylesheet class
 * cannot reach — the last item of a container that spaces its children with `gap`, a table's `append` slot, under a bar
 * fixed to the page's foot. It reads that one value, and 0 leaves nothing, so a page beside the conversation has no blank
 * strip where the composer used to be.
 */

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

/** `ShellDockRoom` at the shell's measurement, as the last item of a container that spaces its children with `gap`. */
async function mounted(space: Ref<number>) {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({
    render: () => h("div", { style: "display: flex; flex-direction: column; gap: 16px" }, [h("p", "content"), h(ShellDockRoom)]),
  });
  app.provide(pageDockSpaceKey, space);
  app.mount(root);
  await nextTick();
  return root;
}

it("keeps the measured room as the content's last item, and no item at all beside the conversation", async () => {
  const space = ref(56);
  const root = await mounted(space);
  const room = root.querySelector<HTMLElement>(".shell-dock-room-end")!;
  expect(root.firstElementChild?.lastElementChild).toBe(room);
  expect(room.getAttribute("aria-hidden")).toBe("true");

  // Beside the conversation the composer is gone: the item leaves with it, so the container's gap has no empty slot.
  space.value = 0;
  await nextTick();
  expect(root.querySelector(".shell-dock-room-end")).toBeNull();
});
