import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const java = vi.hoisted(() => ({ form: vi.fn(), saveEntries: vi.fn() }));
const agents = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../assistant/default-agents", () => ({ listDefaultAgentOptions: agents.list }));
vi.mock("../../../utils/backend-client", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../utils/backend-client")>()),
  backendPost: async () => ({ text: JSON.stringify({ success: true, data: await java.form() }) }),
}));
vi.mock("../application-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("../application-catalogue")>();
  return { ...actual, applicationCatalogueClient: (viewer: never) => ({ ...actual.applicationCatalogueClient(viewer), ...java }) };
});

const { createApplicationReadAdapter } = await import("../application-catalogue");
const { productCatalogServerOperations } = await import("../catalog-operations");
const save = productCatalogServerOperations.find(operation => operation.handlerRef === `${APPLICATION}.save`)!;

const owner = { domainId: "domain", userId: "reader" };
const analyst = { kind: "id", id: "agent-analyst" };
const entry = (defaultAgent?: unknown) => ({
  id: "use-one", pageKey: "one", panelId: "panel-one", path: "/one", access: { kind: "domain-member" },
  ...(defaultAgent === undefined ? {} : { defaultAgent }),
});
const values = (defaultAgent?: unknown) => ({ entry: { path: "/applications/app-one", renderer: "panels" }, panelUses: [entry(defaultAgent)] });
const field = (path: string, control: unknown) => ({ path, label: path, valueSchema: {}, required: false, readOnly: false, control });
const description = (agentControl: unknown) => ({
  fields: [field("/panelUses", { kind: "object-array", itemFields: [field("/pageKey", { kind: "text" }), field("/defaultAgent", agentControl)] })],
  values: values(), errors: [], save: { method: "PUT", path: "/platform/applications/app-one/panel-uses", bodySchema: {}, draftOperation: "saveEntries" },
});
const saveEntries = (defaultAgent?: unknown) => save.execute(
  { executor: { owner, credentials: { locale: "en" } } } as never,
  { kind: "object", objectType: APPLICATION, primaryKey: "app-one" } as never,
  { values: values(defaultAgent) }, "intent-one");

beforeAll(() => configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
}));

beforeEach(() => {
  vi.resetAllMocks();
  agents.list.mockResolvedValue([{ value: analyst, label: "Analyst" }]);
});

it("offers the agent owner's default agents in each entry's select", async () => {
  java.form.mockResolvedValue(description({ kind: "select", options: [] }));
  const form = await createApplicationReadAdapter(owner, { locale: "en" } as never).form("app-one", { section: "entries" });
  const rows = form.fields[0]!.control as { itemFields: { path: string; control: unknown }[] };
  expect(rows.itemFields).toEqual([
    expect.objectContaining({ path: "/pageKey", control: { kind: "text" } }),
    expect.objectContaining({ path: "/defaultAgent", control: { kind: "select", options: [
      { value: analyst, label: "Analyst", description: null, disabled: false, disabledReason: null },
    ] } }),
  ]);
  expect(agents.list).toHaveBeenCalledWith("domain", "en");
});

it("leaves a default agent the owner does not declare as a select as it is", async () => {
  java.form.mockResolvedValue(description({ kind: "code", language: "json" }));
  await createApplicationReadAdapter(owner, { locale: "en" } as never).form("app-one", { section: "entries" });
  expect(agents.list).not.toHaveBeenCalled();
});

it.each([
  ["a value that is not a default agent object", "agent-analyst"],
  ["an object of another shape", { kind: "id" }],
])("refuses %s at its field, before the owner is called", async (_case, defaultAgent) => {
  const outcome = await saveEntries(defaultAgent);
  expect(outcome).toMatchObject({ kind: "refusal", code: "APPLICATION_ENTRY_INVALID",
    errors: [{ field: "/panelUses/0/defaultAgent", code: "invalid_object", message: expect.stringContaining(JSON.stringify(defaultAgent)) }] });
  expect(java.saveEntries).not.toHaveBeenCalled();
});

it.each([
  ["an offered agent", analyst],
  ["an agent the current list no longer offers, which the owners judge", { kind: "id", id: "agent-disabled" }],
  ["no default agent", undefined],
])("hands %s to the owner without reading the list", async (_case, defaultAgent) => {
  expect(await saveEntries(defaultAgent)).toMatchObject({ kind: "success" });
  expect(java.saveEntries).toHaveBeenCalledWith("app-one", values(defaultAgent));
  expect(agents.list).not.toHaveBeenCalled();
});

it("names a malformed entry value at its field in the reader's words, never as the parser's text", async () => {
  java.form.mockResolvedValue({ ...description({ kind: "select", options: [] }), fields: [field("/panelUses", { kind: "object-array",
    itemFields: [field("/pageKey", { kind: "text" }), field("/inputs", { kind: "code", language: "json" })] })] });
  const outcome = await save.execute(
    { locale: "en", executor: { owner, credentials: { locale: "en" } } } as never,
    { kind: "object", objectType: APPLICATION, primaryKey: "app-one" } as never,
    { values: { ...values(), panelUses: [{ ...entry(), inputs: { term: 1 } }] } }, "intent-one");
  expect(outcome).toMatchObject({ kind: "refusal", code: "INVALID_REQUEST",
    errors: [{ field: "/panelUses/0/inputs", code: "invalid_format", message: "This value is not valid here." }] });
  expect(JSON.stringify(outcome)).not.toContain("invalid_union");
  expect(java.saveEntries).not.toHaveBeenCalled();
});
