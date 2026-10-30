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
  it("shows a dependent action when a previously missing row-selection variable is assigned", async () => {
    const view = createObjectView("Person");
    const table = createViewWidget("table"); table.variable = "selected"; table.binding = { source: "literal", value: [{ id: "exchange-1", name: "Conference" }] };
    const action = createViewWidget("action"); action.title = "Maintain exchange"; action.resourceId = "maintain";
    action.visibleWhen = { binding: { source: "variable", path: "selected.id" }, operator: "present", value: "" };
    view.tabs[0].sections[0].widgets = [table, action];
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: {}, reference: { className: "Person", primaryKey: "1" } }));
    await settle();
    expect(element.textContent).not.toContain("Maintain exchange");
    (element.querySelector(".el-table__body tr") as HTMLElement).click(); await settle();
    expect(element.textContent).toContain("Maintain exchange");
  });
  it("uses configured select options and does not label an unknown code as a degree", async () => {
    const view = createObjectView("Person");
    const properties = createViewWidget("properties"); properties.fields = ["degree"];
    properties.fieldOptions = { degree: [{ value: "Doctor", label: "Doctor" }, { value: "Master", label: "Master" }] };
    const action = createViewWidget("action"); action.resourceId = "degree"; action.title = "Edit degree";
    action.fieldOptions = properties.fieldOptions;
    action.parameters = { degree: { source: "object", path: "degree" } };
    view.tabs[0].sections[0].widgets = [properties, action];
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify({ success: true, data: url.endsWith("queryById") ? { function: { parameters: [{ name: "degree", type: "TYPE_STRING" }] } } : {} })));
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { degree: "2" }, reference: { className: "Person", primaryKey: "1" } }));
    await settle();
    expect(element.querySelector("dd")?.textContent).toContain("Unrecognized value");
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Edit degree")!.click();
    await settle();
    expect(element.querySelector(".object-action-dialog .el-select")).not.toBeNull();
    expect(element.querySelector(".object-action-dialog .el-select__selected-item")?.textContent).not.toBe("2");
  });
  it("shows the current person and submits the bound identity even if the readonly input is tampered with", async () => {
    const view = createObjectView("Person");
    const action = createViewWidget("action"); action.resourceId = "degree"; action.title = "Edit degree";
    action.contextFields = ["name"];
    action.readOnlyParameters = ["person_id"];
    action.parameters = { person_id: { source: "object", path: "id" } };
    view.tabs[0].sections[0].widgets = [action];
    let submitted: FormData | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/execute")) submitted = init.body as FormData;
      return new Response(JSON.stringify({ success: true, data: url.endsWith("queryById") ? { function: { parameters: [{ name: "person_id", type: "TYPE_STRING" }] } } : {} }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "person-1", name: "王维成" }, reference: { className: "Person", primaryKey: "person-1" } }));
    await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Edit degree")!.click(); await settle();
    expect(element.querySelector(".action-context")?.textContent).toContain("王维成");
    expect(element.querySelector(".action-readonly-value")?.textContent).toBe("person-1");
    expect(element.querySelector(".object-action-dialog input")).toBeNull();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!.click(); await settle();
    expect(JSON.parse(String(submitted?.get("param")))).toEqual({ person_id: "person-1" });
  });
  it("shows success and refreshed properties after submitting an action", async () => {
    const view = createObjectView("Person");
    const properties = createViewWidget("properties"); properties.fields = ["degree"];
    const action = createViewWidget("action"); action.resourceId = "update-degree"; action.title = "Update degree";
    view.tabs[0].sections[0].widgets = [properties, action];
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify({ success: true, data: url.endsWith("queryById") ? { function: { parameters: [{ name: "degree", type: "TYPE_STRING" }] } } : {} })));
    const object = ref({ degree: "Bachelor" });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: object.value, reference: { className: "Person", primaryKey: "1" }, onRefresh: () => { object.value = { degree: "Doctor" }; } }));
    await settle();
    const button = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Update degree")!;
    button.click(); await settle();
    const submit = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!;
    submit.click(); await settle();
    expect(element.textContent).toContain("Operation completed successfully");
    expect(element.querySelector(".el-message--success")).not.toBeNull();
    expect(element.querySelector(".view-widget .el-alert--success")).toBeNull();
    expect(element.querySelector("dd")?.textContent).toBe("Doctor");
    await new Promise(resolve => setTimeout(resolve, 3400));
    await nextTick();
    expect(element.querySelector(".el-message--success")).toBeNull();
  });
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
