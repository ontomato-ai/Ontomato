import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import CapabilityMap from "../components/CapabilityMap.vue";
import TriggerCatalog from "../components/TriggerCatalog.vue";
import { buildCapabilityMap } from "../components/capability-map-model";
import {
  CAPABILITY_LABEL_SIZE,
  CAPABILITY_LABEL_WIDTH,
  capabilityKinds,
  capabilityMapLayout,
  type CapabilityNode,
} from "../components/capability-map-rendering";
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

it("opens the capability map with every name readable and none overlapping, small domain or large", () => {
  const domain = (counts: Partial<Record<CapabilityNode["kind"], number>>): CapabilityNode[] =>
    capabilityKinds.flatMap((kind) =>
      Array.from({ length: counts[kind] ?? 0 }, (_, index) => ({
        id: `${kind}:${index}`,
        kind,
        layer: kind === "subject" || kind === "role" ? ("governance" as const) : ("capability" as const),
        label: `${kind} ${index}`,
        detail: "",
      })),
    );
  // The canvases the page gives the map in a 1440×900 window: the open-source domain, and the internal one with ninety
  // objects that a fitted ring drew at two pixels a name.
  const small = capabilityMapLayout(domain({ action: 3, metric: 5, function: 8, skill: 6 }), { width: 946, height: 627 });
  const large = capabilityMapLayout(
    domain({ subject: 19, role: 7, action: 8, workflow: 2, trigger: 2, metric: 20, function: 26, skill: 6 }),
    { width: 946, height: 734 },
  );

  // The small one is drawn whole, at natural size.
  expect(small.zoom).toBe(1);
  expect(small.offset.x).toBeGreaterThanOrEqual(0);
  expect(small.offset.x + small.width * small.zoom).toBeLessThanOrEqual(946);
  expect(small.offset.y + small.height * small.zoom).toBeLessThanOrEqual(627);
  // The large one does not fit at a readable size, so it opens readable at its start and runs on to the right.
  expect(large.zoom * CAPABILITY_LABEL_SIZE).toBeGreaterThanOrEqual(11);
  expect(large.offset.y + large.height * large.zoom).toBeLessThanOrEqual(734);

  for (const layout of [small, large]) {
    const points = Object.values(layout.positions);
    // Two names collide when they sit within a label's width side by side and within a node and its label one above
    // the other.
    const collisions = points.flatMap((a, i) =>
      points.slice(i + 1).filter((b) => Math.abs(a.x - b.x) < CAPABILITY_LABEL_WIDTH && Math.abs(a.y - b.y) < 56),
    );
    expect(collisions).toEqual([]);
  }
});

it("names what a trigger starts and the kind of its condition, not the stored ids", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  vi.stubGlobal("fetch", async (url: string) => {
    const data = url.endsWith("/trigger/queryList")
      ? [
          {
            id: "t1",
            name: "Monthly approval",
            status: "PENDING_REVIEW",
            conditionKind: "time",
            condition: { frequency: { kind: "monthly", day: 1, time: "00:00" } },
            effectKind: "action",
            effect: { actionId: "e2e-org-expense-v2-approve" },
          },
          {
            id: "t2",
            name: "Weekly review",
            status: "PUBLISHED",
            conditionKind: "time",
            condition: { frequency: { kind: "weekly", weekday: 1, time: "09:00" } },
            effectKind: "workflow",
            effect: { workflowId: "deleted-process" },
          },
        ]
      : url.endsWith("/action/queryList") ? [{ id: "e2e-org-expense-v2-approve", name: "Approve expense" }]
      : [];
    return new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } });
  });
  app = createApp({ setup() {
    provideManagerFeedback(ref(root));
    return () => h(TriggerCatalog);
  } });
  installObjectViewHost(app);
  app.mount(root);
  await flush();
  const rows = [...root.querySelectorAll(".el-table__body tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim()),
  );
  // Effect and condition are the second and third columns.
  expect(rows.map((cells) => cells.slice(1, 3))).toEqual([
    ["Action · Approve expense", "Time table"],
    // A process no catalogue names any more is still shown, by the id the trigger stored.
    ["Process · deleted-process", "Time table"],
  ]);
});
