import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { createObjectView, createViewWidget } from "@ontomato/contracts/object-views";
import ObjectViewRuntime from "../object-views/ObjectViewRuntime.vue";
import ObjectViewBuilder from "../object-views/ObjectViewBuilder.vue";
import ObjectViewPage from "../object-views/ObjectViewPage.vue";
import { provideManagerContext, type ManagerHostContext } from "../context";
import { provideManagerFeedback } from "../feedback";
import { englishMessages } from "../i18n";
import { ref } from "vue";

const apps: App[] = [];
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const context: ManagerHostContext = {
  apiBase: "/api", credential: { type: "anonymous" }, locale: "en", messages: englishMessages,
  theme: "light", view: "/views/Order", embedded: false, knowledgeGovernanceUrl: null,
  dataFallbacks: { noBusinessDescription: "", unnamedAsset: "" }, knowledgeTagValues: { general: "", business: "", tech: "" },
  presentation: { themeProperties: { light: {}, dark: {} }, nodePalette: [], edgeLabel: {}, maxFitZoom: null, dataBrowserDescription: () => "", compactDialogs: false },
};
function mount(child: () => ReturnType<typeof h>) {
  const element = document.createElement("div"); document.body.append(element);
  const app = createApp(defineComponent({ setup() {
    provideManagerContext(reactive(context), () => {});
    provideManagerFeedback(ref(element));
    return child;
  } }));
  app.mount(element); apps.push(app); return element;
}
async function settle() { for (let index = 0; index < 12; index++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); } }

describe("configured object view interaction", () => {
  it("updates a bound metric and conditional component when an input variable changes", async () => {
    const view = createObjectView("Order");
    view.variables.filter = "initial";
    const input = createViewWidget("input"); input.variable = "filter";
    const metric = createViewWidget("metric"); metric.binding = { source: "variable", path: "filter" };
    const text = createViewWidget("text"); text.text = "Now visible";
    text.visibleWhen = { binding: { source: "variable", path: "filter" }, operator: "eq", value: "changed" };
    view.tabs[0].sections[0].widgets = [input, metric, text];
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("initial");
    expect(element.textContent).not.toContain("Now visible");
    const field = element.querySelector("input")!; field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("changed");
    expect(element.textContent).toContain("Now visible");
  });
  it("saves and publishes the actual configured layout with optimistic revision", async () => {
    const calls: Array<{ url: string; body: Record<string, any> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); calls.push({ url, body });
      const data = url.endsWith("/edit") ? { revision: 0, publishedRevision: null, versions: [] }
        : url.endsWith("getMetas") ? { classDef: [{ className: "Order", showName: "Order", attrs: [{ name: "id", primaryKey: true }] }] }
        : url.endsWith("/save") ? { revision: 1, publishedRevision: null, versions: [{ revision: 1, document: body.document }] }
        : url.endsWith("/publish") ? { revision: 1, publishedRevision: 1, versions: [] } : [];
      return new Response(JSON.stringify({ success: true, data }));
    });
    const element = mount(() => h(ObjectViewBuilder, { className: "Order" }));
    await settle();
    const textButton = Array.from(element.querySelectorAll(".palette button")).find(button => button.textContent?.trim() === "Text") as HTMLButtonElement;
    textButton.click(); await settle();
    const publish = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Save and publish") as HTMLButtonElement;
    publish.click(); await settle();
    const save = calls.find(call => call.url.endsWith("/save"));
    expect(save?.body.expectedRevision).toBe(0);
    expect(save?.body.document.tabs[0].sections[0].widgets.map((widget: { kind: string }) => widget.kind)).toEqual(["properties", "text"]);
    expect(calls.find(call => call.url.endsWith("/publish"))?.body).toMatchObject({ revision: 1, expectedRevision: 1, form: "full" });
    expect(element.textContent).toContain("Published 1");
  });
  it("preserves input state when the host recreates an identical object reference", async () => {
    const view = createObjectView("Order");
    const input = createViewWidget("input"); input.variable = "filter";
    const metric = createViewWidget("metric"); metric.binding = { source: "variable", path: "filter" };
    view.variables.filter = "initial";
    view.tabs[0].sections[0].widgets = [input, metric];
    const version = ref(0);
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1", version: version.value }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    const field = element.querySelector("input")!;
    field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    version.value++; await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("changed");
  });
  it("always edits the shared full view", async () => {
    const forms: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.endsWith("/edit")) forms.push(body.form);
      return new Response(JSON.stringify({ success: true, data: url.endsWith("/edit") ? { revision: 0, publishedRevision: null, versions: [] } : url.endsWith("getMetas") ? { classDef: [] } : [] }));
    });
    mount(() => h(ObjectViewBuilder, { className: "Order" }));
    await settle();
    expect(forms).toEqual(["full"]);
  });
  it("does not reload published configuration when runtime variables or object data change", async () => {
    const view = createObjectView("Order");
    const input = createViewWidget("input"); input.variable = "filter";
    const metric = createViewWidget("metric"); metric.binding = { source: "variable", path: "filter" };
    view.variables.filter = "initial";
    view.tabs[0].sections[0].widgets = [input, metric];
    let reads = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/read")) reads++;
      return new Response(JSON.stringify({ success: true, data: url.endsWith("/read") ? { revision: 1, publishedRevision: 1, versions: [{ document: view }] } : { data: { id: "1" } } }));
    });
    const version = ref(0);
    const element = mount(() => { void version.value; return h(ObjectViewPage, { reference: { className: "Order", primaryKey: "1" } }); });
    await settle();
    const field = element.querySelector("input")!;
    field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    version.value++; await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("changed");
    expect(reads).toBe(1);
  });
  it("queries a bound MetricView once for each changed parameter", async () => {
    const view = createObjectView("Order");
    view.variables.filter = "initial";
    const input = createViewWidget("input"); input.variable = "filter";
    const metric = createViewWidget("metric"); metric.resourceId = "metric-1"; metric.valueField = "value";
    metric.parameters.filter = { source: "variable", path: "filter" };
    view.tabs[0].sections[0].widgets = [input, metric];
    const values: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); values.push(body.param.filter);
      return new Response(JSON.stringify({ success: true, data: [{ value: body.param.filter }] }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    const field = element.querySelector("input")!;
    field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    expect(values).toEqual(["initial", "changed"]);
    expect(element.querySelector(".metric")?.textContent).toBe("changed");
  });
});
