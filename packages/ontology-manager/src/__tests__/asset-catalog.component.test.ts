import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import TriggerCatalog from "../components/TriggerCatalog.vue";
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
