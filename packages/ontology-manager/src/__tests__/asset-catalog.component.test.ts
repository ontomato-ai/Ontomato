import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import TriggerCatalog from "../components/TriggerCatalog.vue";
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

it("names what a trigger starts, its condition and its cadence in the reader's words, not the stored values", async () => {
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
  // Effect, condition and cadence are the second to fourth columns; the cadence is worded from the stored structure.
  expect(rows.map((cells) => cells.slice(1, 4))).toEqual([
    ["Action · Approve expense", "Time table", "Day 1 of every month at 00:00"],
    // A process no catalogue names any more is still shown, by the id the trigger stored.
    ["Process · deleted-process", "Time table", "Every Monday at 09:00"],
  ]);
});
