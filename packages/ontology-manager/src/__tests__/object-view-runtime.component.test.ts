import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { createObjectView, createViewWidget } from "@ontomato/contracts/object-views";
import ObjectViewRuntime from "../object-views/ObjectViewRuntime.vue";
import ObjectViewBuilder from "../object-views/ObjectViewBuilder.vue";
import ObjectViewPage from "../object-views/ObjectViewPage.vue";
import ViewBindingEditor from "../object-views/ViewBindingEditor.vue";
import type { ViewBinding } from "@ontomato/contracts/object-views";
import { installObjectViewHost } from "./object-view-host";
import { managerOverlayKey } from "../overlay";
import { provideManagerFeedback } from "../feedback";
import { ref } from "vue";

const apps: App[] = [];
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function mount(child: () => ReturnType<typeof h>) {
  const element = document.createElement("div"); document.body.append(element);
  const app = createApp(defineComponent({ setup() {
    provideManagerFeedback(ref(element));
    return child;
  } }));
  installObjectViewHost(app);
  app.provide(managerOverlayKey, element);
  app.mount(element); apps.push(app); return element;
}
async function settle() { for (let index = 0; index < 12; index++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); } }
const answer = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
/** The data engine's Action form with one text field per value; `parameters` answers a submission. */
const actionForm = (values: Record<string, string>, parameters: Record<string, unknown> | null = null) => ({
  fields: Object.keys(values).map(key => ({ key, label: key, type: "text", required: false, defaultValue: null, help: null, multiline: false, placeholder: null, maxLength: 65536 })),
  values, errors: [], parameters,
});

describe("configured object view interaction", () => {
  it("selects a defined variable and accepts a nested variable path", async () => {
    const binding = ref<ViewBinding>({ source: "variable", path: "" });
    const element = mount(() => h(ViewBindingEditor, { modelValue: binding.value, variables: ["filter", "selected"], "onUpdate:modelValue": value => { binding.value = value; } }));
    await settle();
    const select = element.querySelectorAll(".el-select")[1];
    (select.querySelector(".el-select__wrapper") as HTMLElement).click(); await settle();
    Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find(item => item.querySelector("span")?.textContent === "filter")!.click();
    await settle();
    expect(binding.value).toEqual({ source: "variable", path: "filter" });
    (select.querySelector(".el-select__wrapper") as HTMLElement).click(); await settle();
    const input = select.querySelector("input")!;
    input.value = "selected.name"; input.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find(item => item.textContent === "selected.name")!.click();
    await settle();
    expect(binding.value).toEqual({ source: "variable", path: "selected.name" });
  });
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
    vi.stubGlobal("fetch", async (url: string) => answer(url.endsWith("/action/form") ? actionForm({ degree: "2" }) : {}));
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { degree: "2" }, reference: { className: "Person", primaryKey: "1" } }));
    await settle();
    expect(element.querySelector("dd")?.textContent).toContain("Unrecognized value");
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Edit degree")!.click();
    await settle();
    expect(element.querySelector(".object-action-dialog .el-select")).not.toBeNull();
    expect(element.querySelector(".object-action-dialog .el-select__selected-item")?.textContent).not.toBe("2");
  });
  it("shows the current person read-only and executes what the form answers for the bound identity", async () => {
    const view = createObjectView("Person");
    const action = createViewWidget("action"); action.resourceId = "degree"; action.title = "Edit degree";
    action.contextFields = ["name"];
    action.readOnlyParameters = ["person_id"];
    action.parameters = { person_id: { source: "object", path: "id" } };
    view.tabs[0].sections[0].widgets = [action];
    const forms: unknown[] = [];
    let submitted: FormData | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/action/form")) {
        const body = JSON.parse(String(init.body));
        forms.push(body);
        return answer(actionForm({ person_id: "person-1" }, body.values ? { person_id: "person-1" } : null));
      }
      if (url.endsWith("/execute")) submitted = init.body as FormData;
      return answer({});
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "person-1", name: "王维成" }, reference: { className: "Person", primaryKey: "person-1" } }));
    await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Edit degree")!.click(); await settle();
    expect(element.querySelector(".action-context")?.textContent).toContain("王维成");
    expect(element.querySelector(".object-action-dialog .read-only")?.textContent).toBe("person-1");
    expect(element.querySelector(".object-action-dialog input")).toBeNull();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!.click(); await settle();
    expect(forms).toHaveLength(2);
    expect(forms[0]).toMatchObject({ id: "degree", parameters: { person_id: "person-1" }, readOnlyParameters: ["person_id"] });
    expect(forms[0]).not.toHaveProperty("values");
    expect(forms[1]).toMatchObject({ id: "degree", parameters: { person_id: "person-1" }, values: { person_id: "person-1" }, readOnlyParameters: ["person_id"] });
    expect(JSON.parse(String(submitted?.get("param")))).toEqual({ person_id: "person-1" });
  });
  it("shows the field errors the form answers and executes nothing", async () => {
    const view = createObjectView("Order");
    const action = createViewWidget("action"); action.resourceId = "ship"; action.title = "Ship order";
    view.tabs[0].sections[0].widgets = [action];
    let executions = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/execute")) executions++;
      if (!url.endsWith("/action/form")) return answer({});
      const body = JSON.parse(String(init.body));
      return answer(body.values
        ? { ...actionForm(body.values), errors: [{ field: "/values/quantity", code: "invalid_number", message: "Invalid value for quantity" }] }
        : actionForm({ quantity: "" }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Ship order")!.click(); await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!.click(); await settle();
    await vi.waitFor(() => expect(element.querySelector('.object-action-dialog [data-field="quantity"] .el-form-item__error')?.textContent).toContain("Invalid value for quantity"));
    expect(executions).toBe(0);
  });
  it("shows success and refreshed properties after submitting an action", async () => {
    const view = createObjectView("Person");
    const properties = createViewWidget("properties"); properties.fields = ["degree"];
    const action = createViewWidget("action"); action.resourceId = "update-degree"; action.title = "Update degree";
    view.tabs[0].sections[0].widgets = [properties, action];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (!url.endsWith("/action/form")) return answer({});
      const body = JSON.parse(String(init.body));
      return answer(actionForm({ degree: body.values?.degree ?? "" }, body.values ?? null));
    });
    const object = ref({ degree: "Bachelor" });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: object.value, reference: { className: "Person", primaryKey: "1" }, onRefresh: () => { object.value = { degree: "Doctor" }; } }));
    await settle();
    const button = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Update degree")!;
    button.click(); await settle();
    const submit = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!;
    submit.click(); await settle();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.querySelector('.view-widget [role="alert"]')).toBeNull();
    expect(element.querySelector("dd")?.textContent).toBe("Doctor");
    await new Promise(resolve => setTimeout(resolve, 3400));
    await nextTick();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
  it("Action button sends the complete Java form result including null, empty string and zero", async () => {
    const view = createObjectView("Order");
    const action = createViewWidget("action"); action.resourceId = "ship"; action.title = "Ship order";
    view.tabs[0].sections[0].widgets = [action];
    const parameters = { optional: null, text: "", count: 0 };
    let sent: unknown;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/action/form")) return answer(actionForm({}, JSON.parse(String(init.body)).values ? parameters : null));
      if (url.endsWith("/action/execute")) sent = JSON.parse(String((init.body as FormData).get("param")));
      return answer({});
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Ship order")!.click(); await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!.click(); await settle();
    expect(sent).toEqual(parameters);
  });
  it("reads a bound MetricView again after an Action succeeds", async () => {
    const view = createObjectView("Order");
    const metric = createViewWidget("metric"); metric.resourceId = "metric-1"; metric.valueField = "value";
    const action = createViewWidget("action"); action.resourceId = "ship"; action.title = "Ship order";
    view.tabs[0].sections[0].widgets = [metric, action];
    let reads = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/metricView/execute")) return answer([{ value: `read ${++reads}` }]);
      if (url.endsWith("/action/form")) return answer(actionForm({}, JSON.parse(String(init.body)).values ? {} : null));
      return answer({});
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("read 1");
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Ship order")!.click(); await settle();
    Array.from(element.querySelectorAll("button")).find(button => button.textContent?.trim() === "Submit")!.click(); await settle();
    expect(element.querySelector(".metric")?.textContent).toBe("read 2");
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
  it("searches preview objects within the current class, displays business names and loads by primary key", async () => {
    const searches: Record<string, unknown>[] = [];
    const lookups: Record<string, unknown>[] = [];
    const attrs = [{ name: "id", primaryKey: true }, { name: "name", bizzkeyBool: true }];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.endsWith("getWholeClassDataByPage")) {
        searches.push(body);
        return new Response(JSON.stringify({ success: true, data: [{ id: "order-2", name: "Readable order" }], total_count: 1 }));
      }
      if (url.endsWith("queryInfoByNode")) lookups.push(body);
      const data = url.endsWith("/edit") ? { revision: 0, publishedRevision: null, versions: [] }
        : url.endsWith("getMetas") ? { classDef: [{ className: "Order", showName: "Order", attrs }] }
        : url.endsWith("queryInfoByNode") ? { classDef: { attrs }, data: { name: body.id === "Order:order-1" ? "Initial order" : "Readable order" } } : [];
      return new Response(JSON.stringify({ success: true, data }));
    });
    const element = mount(() => h(ObjectViewBuilder, { className: "Order", initialPrimaryKey: "order-1" }));
    await settle();
    const select = element.querySelector(".preview-object-select")!;
    expect(select.textContent).toContain("Initial order");
    (select.querySelector(".el-select__wrapper") as HTMLElement).click();
    await settle();
    expect(searches[0]).toMatchObject({ classname: "Order" });
    const input = select.querySelector("input")!;
    input.value = "Readable";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 350));
    await settle();
    expect(searches.at(-1)).toMatchObject({ classname: "Order", search: "Readable" });
    const option = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find(item => item.textContent === "Readable order")!;
    expect(option).toBeDefined();
    option.click(); await settle();
    expect(select.textContent).toContain("Readable order");
    Array.from(element.querySelectorAll<HTMLButtonElement>(".palette button")).find(button => button.textContent?.trim() === "Load object")!.click();
    await settle();
    expect(lookups.at(-1)).toEqual({ id: "Order:order-2", class: "Order" });
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
    expect(save?.body.document.tabs[0].sections[0].widgets.map((widget: { kind: string }) => widget.kind)).toEqual(expect.arrayContaining(["properties", "text"]));
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
  it("sends fixed text separately from typed bindings and displays execution errors", async () => {
    const view = createObjectView("Order");
    view.variables.limit = 7;
    const chart = createViewWidget("chart"); chart.resourceId = "metric-1";
    chart.parameters = {
      top_n: { source: "literal", value: "abc" },
      limit: { source: "variable", path: "limit" },
      count: { source: "object", path: "count" },
    };
    view.tabs[0].sections[0].widgets = [chart];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("queryById")) return answer({ function: { parameters: [] } });
      expect(JSON.parse(String(init.body))).toEqual({
        id: "metric-1", param: { limit: 7, count: 3 }, parameterTexts: { top_n: "abc" },
      });
      return new Response(JSON.stringify({ success: false, message: "Invalid value for top_n" }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { count: 3 }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    expect(element.textContent).toContain("Invalid value for top_n");
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
      if (_url.endsWith("queryById")) return new Response(JSON.stringify({ success: true, data: { function: { queryPackage: { manifest: { parameterDefs: [{ name: "page_offset", value: 0 }] } } } } }));
      const body = JSON.parse(String(init.body)); values.push(body.param.filter);
      expect(body.param.page_offset).toBe(0);
      return new Response(JSON.stringify({ success: true, data: [{ value: body.param.filter }] }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { id: "1" }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    const field = element.querySelector("input")!;
    field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    expect(values).toContain("initial");
    expect(values.at(-1)).toBe("changed");
    expect(element.querySelector(".metric")?.textContent).toBe("changed");
  });
  it("uses the current binding after clearing a query and never displays the previous query rows", async () => {
    const view = reactive(createObjectView("Order"));
    const table = createViewWidget("table"); table.resourceId = "query-1";
    table.binding = { source: "literal", value: [{ name: "Bound row" }] };
    view.tabs[0].sections[0].widgets = [table];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: [{ name: "Query row" }] })));
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: {}, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    expect(element.textContent).toContain("Query row");
    expect(element.textContent).not.toContain("Bound row");
    view.tabs[0].sections[0].widgets[0].resourceId = "";
    await settle();
    expect(element.textContent).toContain("Bound row");
    expect(element.textContent).not.toContain("Query row");
  });
});
