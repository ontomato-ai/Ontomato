import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import CapabilityMap from "../components/CapabilityMap.vue";
import { buildCapabilityMap } from "../components/capability-map-model";
import ActionDefinitionView from "../components/actionCreation/ActionDefinitionView.vue";
import OntologyAssetCatalog from "../components/OntologyAssetCatalog.vue";
import { installObjectViewHost } from "./object-view-host";
import { provideManagerFeedback } from "../feedback";

let app: App;
afterEach(() => {
  app?.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

describe.each([
  { kind: "actions", status: "PUBLISHED", initial: "PENDING_REVIEW", button: "Update status" },
  { kind: "metrics", status: "PUBLISHED", initial: "PENDING_REVIEW", button: "Update status" },
] as const)("$kind batch status $status", ({ kind, status, initial, button }) => {
  it("selects filtered records, preserves full details, and retains only failures for retry", async () => {
    const records = [
      { id: "one", name: "First target", status: initial, function: { id: "fn-one", code: "original", parameters: [] } },
      { id: "two", name: "Second target", status: initial, function: { id: "fn-two", code: "second" } },
      { id: "three", name: "Other", status: "UNUSED" },
    ];
    const saves: Record<string, unknown>[] = [];
    let fail = true;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      let response: unknown = { success: true };
      if (url.endsWith("/queryList")) response = { success: true, data: records };
      if (url.endsWith("/queryById")) response = { success: true, data: records.find((item) => item.id === body.id) };
      if (url.endsWith("/save")) {
        saves.push(body);
        if (body.id === "two" && fail) response = { success: false, message: "locked" };
        else Object.assign(records.find((item) => item.id === body.id)!, body);
      }
      return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
    });
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({
      setup() {
        provideManagerFeedback(ref(root));
        return () => h(OntologyAssetCatalog, { kind });
      },
    });
    installObjectViewHost(app, "/api", "test");
    app.mount(root);
    await flush();
    const search = root.querySelector<HTMLInputElement>(".catalog-toolbar input")!;
    search.value = "target";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    root.querySelector<HTMLInputElement>(".resource-table-heading input")!.click();
    await flush();
    const submit = () => Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((element) => element.textContent?.includes(button))!.click();
    submit();
    await flush();
    expect(saves).toEqual(records.slice(0, 2).map((record) => ({ ...record, status })));
    expect(root.querySelectorAll(".resource-table-entry input:checked")).toHaveLength(1);
    fail = false;
    await flush();
    submit();
    await flush();
    expect(saves.map((item) => item.id)).toEqual(["one", "two", "two"]);
    expect(root.querySelectorAll(".resource-table-entry input:checked")).toHaveLength(0);
    expect(records[2].status).toBe("UNUSED");
  });
});

it("shows an action's stored field comparisons and keeps message-only conditions readable", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  const action = { definition: { submissionCriteria: { operator: "AND", conditions: [
    { className: "Expense", field: "status", operator: "=", value: "pending", message: "Not pending" },
    { field: "execution_count", operator: "=", value: 0 },
    { message: "Review is required" },
  ] } } };
  app = createApp({ render: () => h(ActionDefinitionView, { action }) });
  installObjectViewHost(app);
  app.mount(root);
  const rows = root.querySelectorAll(".criteria-row");
  expect(rows[0].textContent).toContain("Expense.status");
  expect(rows[0].textContent).toContain("pending");
  expect(rows[0].textContent).not.toContain("AND");
  expect(rows[1].textContent).toContain("AND");
  expect(rows[1].textContent).toContain("execution_count = 0");
  expect(rows[2].textContent?.trim()).toBe("Review is required");
});

it("exposes both relations when one member created and published the same action", async () => {
  // The claim is about the model, not about the canvas: one member who both created and published an action is two
  // facts, so two edges. It is asserted on the pure builder because the graph now draws to a canvas, and jsdom lays
  // nothing out — a canvas element reports a zero rect, so there is no rendered node to click here.
  const model = buildCapabilityMap(
    {
      subjects: [{ id: "member", loginCode: "member", displayName: "Kim", roleIds: [] }],
      workflows: [],
      actions: [{ id: "a", name: "Approve", createdBy: "member", reviewedBy: "member" }],
      metrics: [],
      functions: [],
      skills: [],
      triggers: [],
      grants: [],
      platformAccess: [],
    },
    (key) => key,
  );
  const relations = model.edges.filter((edge) => edge.from === "subject:member" && edge.to === "action:a");
  expect(relations).toHaveLength(2);
  // Two different facts, so two different labels — not the same line drawn twice.
  expect(new Set(relations.map((edge) => edge.label)).size).toBe(2);
  expect(model.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Kim", "Approve"]));

  // The page still mounts and states its counts, which is what the canvas cannot show in this environment.
  const root = document.body.appendChild(document.createElement("div"));
  vi.stubGlobal("fetch", async (url: string) => {
    const data = url.endsWith("/workflow/subjects") ? [{ id: "member", displayName: "Kim", roles: [] }]
      : url.endsWith("/action/queryList") ? [{ id: "a", name: "Approve", createdBy: "member", reviewedBy: "member" }]
      : [];
    return new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } });
  });
  app = createApp({ setup() {
    provideManagerFeedback(ref(root));
    return () => h(CapabilityMap);
  } });
  installObjectViewHost(app);
  app.mount(root);
  await flush();
  // The legend counts the kinds actually present: one subject and one action, and the six kinds with none are still
  // listed at zero — a legend that hides empty kinds would make an unreadable graph look complete.
  const legend = [...root.querySelectorAll(".legend-item")].map((item) => item.textContent?.replace(/\s+/g, " ").trim());
  expect(legend).toContain("Subject 1");
  expect(legend).toContain("Action 1");
  expect(legend).toContain("Process 0");
  expect(legend.some((item) => item?.includes("NaN"))).toBe(false);
});
