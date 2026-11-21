import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { draftScenario, installPlatform, leaveFrame, mountPlatformPage } from "./panel-frame";

/*
 * A draft linked at an address that also carries the page's state (business knowledge, M7 on 128, 2026-11-22): the panel
 * opens at the address's state, and the draft, once a form takes it, moves the panel to where it is edited. The draft
 * wins over the state the address carried: the address follows the panel, and nothing puts the old state back.
 */

const SWITCH_ON_DRAFT = `import { h, resolveComponent, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { manifest, instance } = usePanelContext();
    watch(() => instance.draft.value, (draft) => { if (draft) instance.state.setState({ mode: "edit" }); });
    return () => h("div", [
      h("p", { class: "mode" }, String(instance.state.values.value.mode)),
      ...Object.keys(manifest.members).map(slot => h(resolveComponent("Projection"), { slot })),
    ]);
  },
});
`;

afterEach(leaveFrame);

it("opens the draft before showing the page, then moves the panel where the draft is edited, over the state its address carried", { timeout: 20000 }, async () => {
  const scenario = draftScenario();
  const manifest = definePanel({
    state: { ...scenario.panel.manifest.state, mode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "view" } },
    members: scenario.panel.manifest.members, commands: {},
  });
  scenario.panel.manifest = manifest;
  scenario.panel.content = { ...scenario.panel.content, module: SWITCH_ON_DRAFT };
  // The draft takes a while to read, as on 128 (8 s there): the panel runs and reports its state first.
  installPlatform((request) => request.path.endsWith("/page-draft")
    ? new Promise((resolve) => setTimeout(() => resolve(scenario.answer(request)), 1500))
    : scenario.answer(request));
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/applications/:applicationId/:panelPath(.*)", component: PanelApplicationRoute, props: (route) => ({ applicationId: String(route.params.applicationId) }) },
  ] });
  await router.push(`${scenario.address}&state=${encodeURIComponent(JSON.stringify({ mode: "view" }))}`);
  await router.isReady();
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    // While the draft is read, the reader is told so and never sees the page at the state it is about to leave.
    await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).not.toBeNull(), { timeout: 8000 });
    expect((element.querySelector(".panel-host-direct") as HTMLElement | null)?.style.display).toBe("none");
    await vi.waitFor(() => expect(element.querySelector(".mode")?.textContent).toBe("edit"), { timeout: 8000 });
    await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull());
    expect((element.querySelector(".panel-host-direct") as HTMLElement).style.display).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(element.querySelector(".mode")?.textContent).toBe("edit");
    expect(JSON.parse(String(router.currentRoute.value.query.state))).toMatchObject({ mode: "edit" });
  } finally {
    app.unmount();
  }
});

it("moves the panel where the draft is edited when the page was open at another state before", { timeout: 20000 }, async () => {
  const scenario = draftScenario();
  scenario.panel.manifest = definePanel({
    state: { ...scenario.panel.manifest.state, mode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "view" } },
    members: scenario.panel.manifest.members, commands: {},
  });
  scenario.panel.content = { ...scenario.panel.content, module: SWITCH_ON_DRAFT };
  installPlatform((request) => request.path.endsWith("/page-draft")
    ? new Promise((resolve) => setTimeout(() => resolve(scenario.answer(request)), 1500))
    : scenario.answer(request));
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/applications/:applicationId/:panelPath(.*)", component: PanelApplicationRoute, props: (route) => ({ applicationId: String(route.params.applicationId) }) },
  ] });
  const bare = scenario.address.split("?")[0]!;
  await router.push(`${bare}?state=${encodeURIComponent(JSON.stringify({ mode: "view" }))}`);
  await router.isReady();
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    await vi.waitFor(() => expect(element.querySelector(".mode")?.textContent).toBe("view"), { timeout: 8000 });
    // The same page, kept, opened again with only the draft's link.
    await router.push(scenario.address);
    await vi.waitFor(() => expect(element.querySelector(".mode")?.textContent).toBe("edit"), { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(element.querySelector(".mode")?.textContent).toBe("edit");
  } finally {
    app.unmount();
  }
});
