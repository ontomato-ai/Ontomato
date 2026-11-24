import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { createObjectView, createViewWidget } from "@ontomato/contracts/object-views";
import { chartWidget } from "./chart-fixture";
import ObjectViewRuntime from "../object-views/ObjectViewRuntime.vue";
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
// The platform chart is the shared component; this stub reports the file and output it is given.
vi.mock("@ontomato/foundation-ui/chart", async importOriginal => ({
  ...(await importOriginal<typeof import("@ontomato/foundation-ui/chart")>()),
  MetricChart: {
    props: ["file", "metric", "height", "undated", "empty"],
    setup: (props: { file: unknown; metric: { rows: unknown } }) => () => h("div", { class: "drawn" }, JSON.stringify({ file: props.file, rows: props.metric.rows })),
  },
}));
/** A component without a chart: the fields and interactions these cases configure. */
const widget = createViewWidget;
/** The data engine's Action form with one text field per value; `parameters` answers a submission. */
const actionForm = (values: Record<string, string>, parameters: Record<string, unknown> | null = null) => ({
  fields: Object.keys(values).map(key => ({ key, label: key, type: "text", required: false, defaultValue: null, help: null, multiline: false, placeholder: null, maxLength: 65536 })),
  values, errors: [], parameters,
});

describe("configured object view interaction", () => {
  it('selects a declared result row and passes capability detail values to an Action without object reads',async()=>{
    const view=createObjectView('Order');
    const details=widget('properties');details.resourceId='details';details.variable='details';
    const metric=widget('metric');metric.resourceId='counts';metric.resultIndex=1;metric.valueField='count';
    const action=widget('action');action.resourceId='edit';action.title='Edit selected';action.parameters={id:{source:'context',path:'primaryKey'},name:{source:'variable',path:'details.name'}};
    view.tabs[0].sections[0].widgets=[details,metric,action];
    const forms:unknown[]=[];
    vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
      if(url.endsWith('/metricView/queryById'))return answer({function:{parameters:[]}});
      if(url.endsWith('/metricView/execute'))return answer(JSON.parse(String(init.body)).id==='details'?[{name:'Capability name'}]:[{count:6},{count:5}]);
      if(url.endsWith('/action/form')){forms.push(JSON.parse(String(init.body)));return answer(actionForm({id:'order-1',name:'Capability name'}));}
      return answer({classDef:[]});
    });
    const element=mount(()=>h(ObjectViewRuntime,{document:view,object:{name:'Wrong source'},reference:{className:'Order',primaryKey:'order-1'}}));
    await settle();
    expect(element.querySelector('.metric')?.textContent).toBe('5');
    Array.from(element.querySelectorAll('button')).find(button=>button.textContent==='Edit selected')!.click();await settle();
    expect(forms[0]).toMatchObject({parameters:{id:'order-1',name:'Capability name'}});
  });
  it('renders capability-bound properties and links without reading the object or relationships',async()=>{
    const view=createObjectView('Order');
    const details=widget('properties');details.resourceId='details';details.parameters={id:{source:'context',path:'primaryKey'}};
    const links=widget('links');links.resourceId='items';links.fields=['name'];
    view.tabs[0].sections[0].widgets=[details,links];
    const requests:string[]=[];
    vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
      requests.push(url);
      if(url.endsWith('/metricView/queryById'))return answer({function:{parameters:[]}});
      if(url.endsWith('/metricView/execute')){
        const body=JSON.parse(String(init.body));
        if(body.id==='details'){expect(body.param).toEqual({id:'order-1'});return answer([{name:'Capability result'}]);}
        return answer([{name:'Related result'}]);
      }
      return answer({classDef:[]});
    });
    const element=mount(()=>h(ObjectViewRuntime,{document:view,object:{name:'Direct object value'},reference:{className:'Order',primaryKey:'order-1'}}));
    await settle();
    expect(element.querySelector('dd')?.textContent).toBe('Capability result');
    expect(element.textContent).toContain('Related result');
    expect(requests.some(url=>url.includes('queryInfoByNode')||url.includes('executeDsl'))).toBe(false);
  });
  it("shows a dependent action when a previously missing row-selection variable is assigned", async () => {
    const view = createObjectView("Person");
    const table = widget("table"); table.variable = "selected"; table.binding = { source: "literal", value: [{ id: "exchange-1", name: "Conference" }] };
    const action = widget("action"); action.title = "Maintain exchange"; action.resourceId = "maintain";
    action.visibleWhen = { binding: { source: "variable", path: "selected.id" }, operator: "present", value: "" };
    view.tabs[0].sections[0].widgets = [table, action];
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: {}, reference: { className: "Person", primaryKey: "1" } }));
    await settle();
    expect(element.textContent).not.toContain("Maintain exchange");
    (element.querySelector(".el-table__body tr") as HTMLElement).click(); await settle();
    expect(element.textContent).toContain("Maintain exchange");
  });
  it("shows an empty list property as empty, not as its raw value", async () => {
    const view = createObjectView("Person");
    const properties = widget("properties"); properties.fields = ["photoWorks", "tags"];
    view.tabs[0].sections[0].widgets = [properties];
    vi.stubGlobal("fetch", async () => answer({}));
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { photoWorks: [], tags: ["a"] }, reference: { className: "Person", primaryKey: "1" } }));
    await settle();
    expect(Array.from(element.querySelectorAll("dd")).map(item => item.textContent?.trim())).toEqual(["—", '["a"]']);
  });

  it("uses configured select options and does not label an unknown code as a degree", async () => {
    const view = createObjectView("Person");
    const properties = widget("properties"); properties.fields = ["degree"];
    properties.fieldOptions = { degree: [{ value: "Doctor", label: "Doctor" }, { value: "Master", label: "Master" }] };
    const action = widget("action"); action.resourceId = "degree"; action.title = "Edit degree";
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
    const action = widget("action"); action.resourceId = "degree"; action.title = "Edit degree";
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
    const action = widget("action"); action.resourceId = "ship"; action.title = "Ship order";
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
    const properties = widget("properties"); properties.fields = ["degree"];
    const action = widget("action"); action.resourceId = "update-degree"; action.title = "Update degree";
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
    const action = widget("action"); action.resourceId = "ship"; action.title = "Ship order";
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
    const metric = widget("metric"); metric.resourceId = "metric-1"; metric.valueField = "value";
    const action = widget("action"); action.resourceId = "ship"; action.title = "Ship order";
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
    const input = widget("input"); input.variable = "filter";
    const metric = widget("metric"); metric.binding = { source: "variable", path: "filter" };
    const text = widget("text"); text.text = "Now visible";
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
  it("preserves input state when the host recreates an identical object reference", async () => {
    const view = createObjectView("Order");
    const input = widget("input"); input.variable = "filter";
    const metric = widget("metric"); metric.binding = { source: "variable", path: "filter" };
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
  it("sends fixed text separately from typed bindings and displays execution errors", async () => {
    const view = createObjectView("Order");
    view.variables.limit = 7;
    const chart = chartWidget(); chart.resourceId = "metric-1";
    chart.parameters = {
      top_n: { source: "literal", value: "abc" },
      limit: { source: "variable", path: "limit" },
      count: { source: "object", path: "count" },
    };
    view.tabs[0].sections[0].widgets = [chart];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("queryById")) return answer({ function: { parameters: [] } });
      if (url.endsWith("/metrics/describe")) return answer({ outputColumns: [{ key: "kind" }, { key: "amount" }] });
      expect(JSON.parse(String(init.body))).toEqual({
        id: "metric-1", param: { limit: 7, count: 3 }, parameterTexts: { top_n: "abc" },
      });
      return new Response(JSON.stringify({ success: false, message: "Invalid value for top_n" }));
    });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: { count: 3 }, reference: { className: "Order", primaryKey: "1" } }));
    await settle();
    expect(element.textContent).toContain("Invalid value for top_n");
  });
  it("fills the view's chart from the bound MetricView and runs no skill when the object or a parameter changes", async () => {
    const view = createObjectView("Order");
    view.variables.filter = "initial";
    const input = widget("input"); input.variable = "filter";
    const chart = chartWidget(); chart.resourceId = "metric-1";
    chart.parameters = { id: { source: "context", path: "primaryKey" }, filter: { source: "variable", path: "filter" } };
    view.tabs[0].sections[0].widgets = [input, chart];
    const actions: string[] = [], reads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      actions.push(url);
      if (url.endsWith("queryById")) return answer({ function: { parameters: [] } });
      if (url.endsWith("/metrics/describe")) return answer({ outputColumns: [{ key: "kind" }, { key: "amount" }, { key: "region" }] });
      const body = JSON.parse(String(init.body));
      if (body.id === "metric-1") reads.push(body.param);
      return answer([{ kind: "A", amount: 1, region: "east" }]);
    });
    const reference = ref({ className: "Order", primaryKey: "1" });
    const element = mount(() => h(ObjectViewRuntime, { document: view, object: {}, reference: reference.value }));
    await settle();
    expect(reads.at(-1)).toEqual({ id: "1", filter: "initial" });
    // The MetricView declares one more column than the file draws; the chart fills from the declared columns.
    expect(element.querySelector(".drawn")?.textContent).toContain('"rows":[{"kind":"A","amount":1,"region":"east"}]');
    const field = element.querySelector("input")!;
    field.value = "changed"; field.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    expect(reads.at(-1)).toEqual({ id: "1", filter: "changed" });
    // Another object reads the same MetricView again: its identity is the new one and the variables are its defaults.
    reference.value = { className: "Order", primaryKey: "2" }; await settle();
    expect(reads.at(-1)).toEqual({ id: "2", filter: "initial" });
    expect(actions.some(url => url.includes("/skills"))).toBe(false);
  });
  it("queries a bound MetricView once for each changed parameter", async () => {
    const view = createObjectView("Order");
    view.variables.filter = "initial";
    const input = widget("input"); input.variable = "filter";
    const metric = widget("metric"); metric.resourceId = "metric-1"; metric.valueField = "value";
    metric.parameters.filter = { source: "variable", path: "filter" };
    view.tabs[0].sections[0].widgets = [input, metric];
    const values: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (_url.endsWith("queryById")) return new Response(JSON.stringify({ success: true, data: { function: { queryPackage: { manifest: { parameterDefs: [{ name: "page_offset", value: 0 }] } } } } }));
      if (_url.endsWith("/metrics/describe")) return new Response(JSON.stringify({ outputColumns: [{ key: "value" }] }));
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
    const table = widget("table"); table.resourceId = "query-1";
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
