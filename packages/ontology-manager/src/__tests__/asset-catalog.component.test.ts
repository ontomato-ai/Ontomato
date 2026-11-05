import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import OntologyAssetCatalog from "../components/OntologyAssetCatalog.vue";
import { provideManagerContext, type ManagerHostContext } from "../context";
import { provideManagerFeedback } from "../feedback";
import { englishMessages } from "../i18n";

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
  { kind: "tasks", status: "RUNNING", initial: "STOPPED", button: "Start selected tasks" },
  { kind: "tasks", status: "STOPPED", initial: "RUNNING", button: "Stop selected tasks" },
] as const)("$kind batch status $status", ({ kind, status, initial, button }) => {
  it("selects filtered records, preserves full details, and retains only failures for retry", async () => {
    const records = [
      { id: "one", name: "First target", status: initial, cron: "0 */5 * * * ?", function: { id: "fn-one", code: "original", parameters: [] } },
      { id: "two", name: "Second target", status: initial, cron: "0 */10 * * * ?", function: { id: "fn-two", code: "second" } },
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
        provideManagerContext({
          apiBase: "/api", credential: { type: "token", token: "test" }, locale: "en",
          messages: englishMessages,
          dataFallbacks: { unnamedAsset: "Unnamed", noBusinessDescription: "" },
        } as ManagerHostContext, () => {});
        provideManagerFeedback(ref(root));
        return () => h(OntologyAssetCatalog, { kind });
      },
    });
    app.mount(root);
    await flush();
    const search = root.querySelector<HTMLInputElement>(".catalog-toolbar input")!;
    search.value = "target";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    root.querySelector<HTMLInputElement>(".resource-table-heading input")!.click();
    await flush();
    expect(root.textContent).toContain("2 selected");
    const submit = () => Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((element) => element.textContent?.includes(button))!.click();
    submit();
    await flush();
    expect(saves).toEqual(records.slice(0, 2).map((record) => ({ ...record, status })));
    expect(root.textContent).toContain("1 selected");
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
