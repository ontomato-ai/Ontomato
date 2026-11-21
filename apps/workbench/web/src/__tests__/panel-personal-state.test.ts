import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress } from "@ontomato/contracts/panel-host";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, projections, type Sent } from "./panel-frame";

/*
 * A panel's personal state (product-layer standard, part two): a field declared `personal: true` is kept for each reader
 * by the host — the page opens with the reader's saved value, a change is saved, and what the address asks for wins over
 * the saved value. Any panel declaring such a field gets this; no page keeps its own copy (localStorage) any more.
 *
 * What this rules out: a reader's arrangement (a graph's node positions) lost on leaving and coming back; a saved value
 * overriding the address a link opened.
 */

const app = "app-personal";
const at = (path: string) => `/applications/${app}/${path}`;
const panel = panelRecord("panel-personal", "Personal", definePanel({
  state: {
    layout: { type: { kind: "scalar", type: "string" }, personal: true },
    view: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: true },
  },
  members: {},
  commands: {},
}));
panel.content = { ...panel.content, module: `import { h } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance } = usePanelContext();
  return () => h("div", [
    h("output", { class: "layout" }, String(instance.state.values.value.layout ?? "")),
    h("output", { class: "view" }, String(instance.state.values.value.view ?? "")),
    h("button", { class: "move", onClick: () => instance.state.set("layout", "moved") }, "Move"),
  ]);
} });
` };
let saved: Record<string, unknown> = {};
const writes: unknown[] = [];

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" },
      panelUses: [{ ...panelUse("use-personal", "personal", panel.id, at("board")), names: { en: "Board" } }] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  if (request.path === "/api/product-panels/personal-state/read") {
    const { fields } = request.body as { fields: string[] };
    return Response.json({ values: Object.fromEntries(fields.filter((field) => field in saved).map((field) => [field, saved[field]])) });
  }
  if (request.path === "/api/product-panels/personal-state" && request.method === "PUT") {
    writes.push(request.body);
    saved = { ...saved, ...(request.body as { values: Record<string, unknown> }).values };
    return Response.json({ values: saved });
  }
  return nothingAt(request);
}

afterEach(() => {
  leaveFrame();
  saved = {};
  writes.length = 0;
});

async function open(address: string) {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(address);
  return { sent, ...mountPlatformPage(() => h(PanelApplicationRoute, { applicationId: app }), router) };
}
const text = (selector: string) => document.querySelector(selector)?.textContent;

it("opens with the reader's saved values, saves a change, and reads it back on coming back", async () => {
  saved = { layout: "saved", view: "list" };
  const first = await open(at("board"));
  try {
    await vi.waitFor(() => expect(text(".layout")).toBe("saved"));
    expect(text(".view")).toBe("list");
    document.querySelector<HTMLButtonElement>(".move")!.click();
    await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
    expect(writes[0]).toMatchObject({ source: { kind: "registered", applicationId: app, useId: "use-personal" }, memberPath: [], values: { layout: "moved" } });
  } finally {
    first.app.unmount();
    leaveFrame();
  }
  const again = await open(at("board"));
  try {
    await vi.waitFor(() => expect(text(".layout")).toBe("moved"));
  } finally {
    again.app.unmount();
  }
});

it("takes what the address asks for over the reader's saved value", async () => {
  saved = { view: "list" };
  const opened = await open(panelAddress(at("board"), { view: "grid" }));
  try {
    await vi.waitFor(() => expect(text(".view")).toBe("grid"));
  } finally {
    opened.app.unmount();
  }
});
