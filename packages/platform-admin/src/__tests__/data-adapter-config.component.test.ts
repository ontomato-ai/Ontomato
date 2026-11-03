import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemConfigPage from "../pages/SystemConfigPage.vue";
import DataAdapterConfigCard from "../config/components/DataAdapterConfigCard.vue";
import type {
  DataAdapterConnection,
  DataAdapterInfo,
  DataAdapterTestResult,
  MultiDataSourceDefinition,
} from "@ontomato/contracts/data-adapters";
import { PlatformBusinessError } from "../api";
import { ontologyOutlineSchema } from "../config/types";
import { pageGlobal, testHost, testI18n } from "./host";

/** Two backend GET /businessConfig/dataAdapters responses: the open-source edition installs only postgresql; a larger edition installs 11 (sorted by label). */
const openSourceAdapters: DataAdapterInfo[] = [
  {
    type: "postgresql",
    label: "PostgreSQL",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "postgres" },
  },
];
const enterpriseAdapters: DataAdapterInfo[] = [
  {
    type: "db2",
    label: "DB2",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:db2://host:port/db", user: "db2inst1" },
  },
  {
    type: "dm",
    label: "DM",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:dm://host:port/db", user: "SYSDBA" },
  },
  {
    type: "duckdb",
    label: "DuckDB",
    requiresJoinFields: true,
    fields: ["url"],
    examples: { url: "jdbc:duckdb:/data/example.duckdb" },
  },
  {
    type: "elasticsearch",
    label: "Elasticsearch",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "http://host:9200", user: "elastic" },
  },
  {
    type: "gaussdb",
    label: "GaussDB",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "gaussdb" },
  },
  {
    type: "m3",
    label: "M3",
    requiresJoinFields: false,
    fields: ["url", "company", "user", "password"],
    examples: { url: "192.0.2.72:8080" },
  },
  {
    type: "mysql",
    label: "MySQL",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:mysql://host:port/db?useSSL=false", user: "root" },
  },
  {
    type: "opensearch",
    label: "OpenSearch",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "https://host:9200", user: "admin" },
  },
  {
    type: "oracle",
    label: "Oracle",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:oracle:thin:@//host:port/service", user: "system" },
  },
  {
    type: "postgresql",
    label: "PostgreSQL",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "postgres" },
  },
  {
    type: "sqlserver",
    label: "SQL Server",
    requiresJoinFields: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:sqlserver://host:port;database=db", user: "sa" },
  },
];

const backend = vi.hoisted(() => ({
  adapters: [] as unknown[],
  dataAdapter: "",
  connections: {} as Record<string, unknown>,
  // Java sends null until a multi-source definition is saved.
  multiDataSource: null as unknown,
  schema: {} as unknown,
  used: [] as unknown[],
  multiUsed: [] as unknown[],
  tested: [] as unknown[],
}));

// The endpoints the system configuration page calls, answering from the simulated backend above.
const adminApi = {
  getBusinessConfig: vi.fn(async () => ({
    success: true,
    data: JSON.parse(
      JSON.stringify({
        agents: { coding: { model: null } },
        lang: "en",
        dataAdapter: backend.dataAdapter,
        dataAdapterConnections: backend.connections,
        multiDataSource: backend.multiDataSource,
      })
    ),
  })),
  listDataAdapters: vi.fn(async () => ({
    success: true,
    data: { currentType: backend.dataAdapter, adapters: backend.adapters },
  })),
  useDataAdapter: vi.fn(async (payload: unknown) => {
    backend.used.push(JSON.parse(JSON.stringify(payload)));
    return { success: true };
  }),
  useMultiDataSource: vi.fn(async (payload: unknown) => {
    backend.multiUsed.push(JSON.parse(JSON.stringify(payload)));
    return { success: true };
  }),
  // The real boundary parse of GET /admin/getSchema runs on the stored schema.
  getOntologyOutline: vi.fn(async () => ontologyOutlineSchema.parse(backend.schema)),
  testDataAdapter: vi.fn(async (payload: unknown): Promise<unknown> => {
    backend.tested.push(JSON.parse(JSON.stringify(payload)));
    return { success: true, data: postgresReport };
  }),
};

const i18n = testI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;
const host = testHost(adminApi);
const global = { ...pageGlobal(host, i18n), stubs: { teleport: true } };

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});
beforeEach(() => {
  vi.clearAllMocks();
  backend.used = [];
  backend.multiUsed = [];
  backend.tested = [];
  backend.connections = {};
  backend.multiDataSource = null;
});

async function mountCard(
  adapters: DataAdapterInfo[],
  dataAdapter: string,
  connections: Record<string, DataAdapterConnection> = {}
) {
  backend.adapters = adapters;
  backend.dataAdapter = dataAdapter;
  backend.connections = connections;
  const page = mount(SystemConfigPage, { global });
  wrappers.push(page);
  await flushPromises();
  return page.findComponent(DataAdapterConfigCard);
}

type Card = Awaited<ReturnType<typeof mountCard>>;

const radioLabels = (card: Card) => card.findAll(".el-radio").map((radio) => radio.text());
const formLabels = (card: Card) =>
  card.findAll(".el-form-item__label").map((label) => label.text());

const placeholders = (card: Card) =>
  card.findAll("input.el-input__inner").map((input) => input.attributes("placeholder"));

describe("the data adapter card renders from the backend list", () => {
  it("the open-source list has only postgresql: shows just that item, selects the current type and fills in the saved connection", async () => {
    const card = await mountCard(openSourceAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });

    expect(radioLabels(card)).toEqual(["PostgreSQL"]);
    expect(card.find(".el-radio.is-checked").text()).toBe("PostgreSQL");
    expect(
      card
        .findAll("input.el-input__inner")
        .map((input) => (input.element as HTMLInputElement).value)
    ).toEqual(["jdbc:postgresql://db/app", "pg", "secret"]);
  });

  it("an 11-adapter list: shows all 11 items with display names from the backend label", async () => {
    const card = await mountCard(enterpriseAdapters, "m3");

    expect(radioLabels(card)).toEqual(enterpriseAdapters.map(({ label }) => label));
  });

  it("M3 shows its four fields with the address example and saves them; the password stays masked", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      m3: { url: "m3.test:8080", company: "acme", user: "admin", password: "pw" },
    });

    expect(formLabels(card)).toEqual([
      t("admin.adapterMode"),
      t("admin.connectionUrl"),
      t("admin.company"),
      t("common.username"),
      t("common.password"),
    ]);
    expect(placeholders(card)).toEqual(["192.0.2.72:8080", undefined, undefined, "******"]);
    expect(card.findAll("input.el-input__inner")[3].attributes("type")).toBe("password");
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([
      { type: "m3", url: "m3.test:8080", company: "acme", user: "admin", password: "pw" },
    ]);
    expect(vi.mocked(adminApi.useDataAdapter)).toHaveBeenCalledTimes(1);
  });

  it("renders every field metadata an adapter declares, beyond the original four names", async () => {
    const snowflake: DataAdapterInfo = {
      type: "snowflake",
      label: "Snowflake",
      requiresJoinFields: true,
      fields: [
        "url",
        "account",
        "warehouse",
        "role",
        "database",
        "schema",
        "user",
        "password",
      ],
      examples: { url: "jdbc:snowflake://acct.snowflakecomputing.com" },
      fieldInfos: [
        {
          name: "url",
          label: "Connection URL",
          required: true,
          example: "jdbc:snowflake://acct.snowflakecomputing.com",
        },
        { name: "account", label: "Account", required: true },
        { name: "warehouse", label: "Warehouse", required: true },
        { name: "role", label: "Role" },
        { name: "database", label: "Database", required: true },
        { name: "schema", label: "Schema", required: true },
        { name: "user", label: "Username", required: true },
        { name: "password", label: "Password", required: true, secret: true },
      ],
    };
    const connection = {
      url: "jdbc:snowflake://acct.snowflakecomputing.com",
      account: "acct",
      warehouse: "WH",
      role: "ANALYST",
      database: "ANALYTICS",
      schema: "PUBLIC",
      user: "svc",
      password: "pw",
    };
    const card = await mountCard([snowflake], "snowflake", { snowflake: connection });

    expect(formLabels(card)).toEqual([
      t("admin.adapterMode"),
      "Connection URL",
      "Account",
      "Warehouse",
      "Role",
      "Database",
      "Schema",
      "Username",
      "Password",
    ]);
    const inputs = card.findAll("input.el-input__inner");
    expect(
      inputs.map((input) => (input.element as HTMLInputElement).value)
    ).toEqual([
      connection.url,
      connection.account,
      connection.warehouse,
      connection.role,
      connection.database,
      connection.schema,
      connection.user,
      connection.password,
    ]);
    expect(inputs[7].attributes("type")).toBe("password");
    expect(inputs[7].attributes("placeholder")).toBe("******");
  });

  it("DuckDB has only url: the form shows only the URL with the module example as placeholder and saves only that type's fields", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      mysql: { url: "jdbc:mysql://other", user: "root", password: "x" },
    });
    await card
      .findAll(".el-radio")
      .find((radio) => radio.text() === "DuckDB")!
      .find("input")
      .setValue();
    await flushPromises();

    expect(formLabels(card)).toEqual([t("admin.adapterMode"), t("admin.connectionUrl")]);
    expect(placeholders(card)).toEqual(["jdbc:duckdb:/data/example.duckdb"]);
    await card.find("input.el-input__inner").setValue("jdbc:duckdb:/data/a.duckdb");
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([{ type: "duckdb", url: "jdbc:duckdb:/data/a.duckdb" }]);
  });

  it("switching to a type with three fields: url and user use the module examples as placeholders and that type's url, user and password are saved", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      mysql: { url: "jdbc:mysql://db/app", user: "root", password: "pw" },
    });
    await card
      .findAll(".el-radio")
      .find((radio) => radio.text() === "MySQL")!
      .find("input")
      .setValue();
    await flushPromises();

    expect(formLabels(card)).toEqual([
      t("admin.adapterMode"),
      t("admin.connectionUrl"),
      t("common.username"),
      t("common.password"),
    ]);
    expect(placeholders(card)).toEqual([
      "jdbc:mysql://host:port/db?useSSL=false",
      "root",
      "******",
    ]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([
      { type: "mysql", url: "jdbc:mysql://db/app", user: "root", password: "pw" },
    ]);
  });
});

/** A successful POST /businessConfig/testDataAdapter `data`; catalog is null as some drivers report. */
const postgresReport: DataAdapterTestResult = {
  kind: "catalog",
  elapsedMs: 123,
  databaseProduct: "PostgreSQL",
  databaseVersion: "16.4",
  driverName: "PostgreSQL JDBC Driver",
  driverVersion: "42.7.4",
  catalog: null,
  schema: "public",
  tables: [
    { name: "orders", type: "TABLE" },
    { name: "v_sales", type: "VIEW" },
  ],
};

/** A successful search engine `data` of POST /businessConfig/testDataAdapter. */
const searchReport: DataAdapterTestResult = {
  kind: "search",
  elapsedMs: 45,
  databaseProduct: "OpenSearch",
  databaseVersion: "2.19.1",
  clusterName: "search-prod",
  indices: ["orders", "customers"],
};

const testButton = (card: Card) =>
  card.findAll("button").find((button) => button.text() === t("common.testConnection"));

async function runTest(card: Card) {
  await testButton(card)!.trigger("click");
  await flushPromises();
}

const resultText = (card: Card) => card.find(".adapter-test-result");

async function selectAdapter(card: Card, label: string) {
  await card
    .findAll(".el-radio")
    .find((radio) => radio.text() === label)!
    .find("input")
    .setValue();
  await flushPromises();
}

describe("testing the data adapter connection", () => {
  it("M3 is tested like any adapter, with its four form values", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      m3: { url: "m3.test:8080", company: "acme", user: "admin", password: "pw" },
    });
    await runTest(card);

    expect(backend.tested).toEqual([
      { type: "m3", url: "m3.test:8080", company: "acme", user: "admin", password: "pw" },
    ]);
    expect(backend.used).toEqual([]);
  });

  it("tests the current form values of only the selected type's fields, without saving", async () => {
    const card = await mountCard(enterpriseAdapters, "mysql", {
      mysql: { url: "jdbc:mysql://db/app", user: "root", password: "pw" },
      duckdb: { url: "jdbc:duckdb:/data/old.duckdb" },
    });
    await selectAdapter(card, "DuckDB");
    await card.find("input.el-input__inner").setValue("jdbc:duckdb:/data/new.duckdb");
    await runTest(card);

    expect(backend.tested).toEqual([{ type: "duckdb", url: "jdbc:duckdb:/data/new.duckdb" }]);
    expect(backend.used).toEqual([]);
  });

  it("a successful test shows the server, driver, non-null catalog/schema and the table list with its count", async () => {
    const card = await mountCard(openSourceAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });
    await runTest(card);

    const labels = card.findAll(".el-descriptions__label").map((label) => label.text());
    expect(labels).toEqual([
      t("common.duration"),
      t("admin.databaseProduct"),
      t("admin.databaseDriver"),
      t("admin.databaseSchema"),
    ]);
    const values = card.findAll(".el-descriptions__content").map((value) => value.text());
    expect(values).toEqual([
      "123 ms",
      "PostgreSQL 16.4",
      "PostgreSQL JDBC Driver 42.7.4",
      "public",
    ]);
    expect(resultText(card).text()).toContain(t("admin.dataAdapterTables", { n: 2 }));
    expect(
      card
        .findAll(".adapter-table-list li")
        .map((row) => [
          row.find(".adapter-table-name").text(),
          row.find(".adapter-table-type").text(),
        ])
    ).toEqual([
      ["orders", "TABLE"],
      ["v_sales", "VIEW"],
    ]);
  });

  it("a successful test with no tables says so instead of an empty list", async () => {
    vi.mocked(adminApi.testDataAdapter).mockResolvedValueOnce({
      success: true,
      data: { ...postgresReport, tables: [] },
    });
    const card = await mountCard(openSourceAdapters, "postgresql", { postgresql: {} });
    await runTest(card);

    expect(card.find(".adapter-table-list").exists()).toBe(false);
    expect(card.find(".card-empty").text()).toBe(t("admin.dataAdapterNoTables"));
  });

  it("a failed test shows the backend message verbatim, line breaks included", async () => {
    const message =
      'FATAL: password authentication failed for user "pg" (SQLState 28P01)\nCaused by: java.io.EOFException';
    vi.mocked(adminApi.testDataAdapter).mockRejectedValueOnce(new Error(message));
    const card = await mountCard(openSourceAdapters, "postgresql", { postgresql: {} });
    await runTest(card);

    expect(card.find("pre.adapter-test-message").element.textContent).toBe(message);
    expect(card.find(".adapter-table-list").exists()).toBe(false);
  });

  it("switching the type clears the last result", async () => {
    const card = await mountCard(enterpriseAdapters, "postgresql", { postgresql: {} });
    await runTest(card);
    expect(resultText(card).exists()).toBe(true);

    await selectAdapter(card, "MySQL");
    expect(resultText(card).exists()).toBe(false);
  });

  it("editing a connection field clears the last result", async () => {
    const card = await mountCard(openSourceAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });
    await runTest(card);
    expect(resultText(card).exists()).toBe(true);

    await card.findAll("input.el-input__inner")[1].setValue("other");
    await flushPromises();
    expect(resultText(card).exists()).toBe(false);
  });

  it("a test answering after a field was edited shows no result for the edited values", async () => {
    let answer!: (value: unknown) => void;
    vi.mocked(adminApi.testDataAdapter).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const card = await mountCard(openSourceAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app" },
    });
    await runTest(card);
    await card.find("input.el-input__inner").setValue("jdbc:postgresql://db/other");
    await flushPromises();
    answer({ success: true, data: postgresReport });
    await flushPromises();

    expect(resultText(card).exists()).toBe(false);
  });

  it("Elasticsearch and OpenSearch are separate types: each shows and tests its own connection without touching the other", async () => {
    const card = await mountCard(enterpriseAdapters, "elasticsearch", {
      elasticsearch: { url: "http://es:9200", user: "elastic", password: "es-pw" },
      opensearch: { url: "https://os:9200", user: "admin", password: "os-pw" },
    });
    const values = () =>
      card.findAll("input.el-input__inner").map((input) => (input.element as HTMLInputElement).value);
    expect(values()).toEqual(["http://es:9200", "elastic", "es-pw"]);

    await selectAdapter(card, "OpenSearch");
    expect(placeholders(card)).toEqual(["https://host:9200", "admin", "******"]);
    expect(values()).toEqual(["https://os:9200", "admin", "os-pw"]);
    await card.find("input.el-input__inner").setValue("https://os-2:9200");
    await runTest(card);

    await selectAdapter(card, "Elasticsearch");
    expect(values()).toEqual(["http://es:9200", "elastic", "es-pw"]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.tested).toEqual([
      { type: "opensearch", url: "https://os-2:9200", user: "admin", password: "os-pw" },
    ]);
    expect(backend.used).toEqual([
      { type: "elasticsearch", url: "http://es:9200", user: "elastic", password: "es-pw" },
    ]);
  });

  it("a search engine report shows the engine, cluster and indices, without driver, catalog, schema or tables", async () => {
    vi.mocked(adminApi.testDataAdapter).mockResolvedValueOnce({ success: true, data: searchReport });
    const card = await mountCard(enterpriseAdapters, "opensearch", { opensearch: {} });
    await runTest(card);

    expect(card.findAll(".el-descriptions__label").map((label) => label.text())).toEqual([
      t("common.duration"),
      t("admin.searchEngine"),
      t("admin.searchCluster"),
    ]);
    expect(card.findAll(".el-descriptions__content").map((value) => value.text())).toEqual([
      "45 ms",
      "OpenSearch 2.19.1",
      "search-prod",
    ]);
    expect(resultText(card).text()).toContain(t("admin.dataAdapterIndices", { n: 2 }));
    expect(card.findAll(".adapter-table-list li").map((row) => row.text())).toEqual([
      "orders",
      "customers",
    ]);
    expect(resultText(card).text()).not.toContain(t("admin.dataAdapterTables", { n: 2 }));
  });

  it("a search engine report with no indices and no version or cluster says there are no indices", async () => {
    vi.mocked(adminApi.testDataAdapter).mockResolvedValueOnce({
      success: true,
      data: { ...searchReport, databaseVersion: null, clusterName: null, indices: [] },
    });
    const card = await mountCard(enterpriseAdapters, "elasticsearch", { elasticsearch: {} });
    await runTest(card);

    expect(card.find(".el-alert--success").exists()).toBe(true);
    expect(card.findAll(".el-descriptions__label").map((label) => label.text())).toEqual([
      t("common.duration"),
      t("admin.searchEngine"),
    ]);
    expect(card.find(".adapter-table-list").exists()).toBe(false);
    expect(card.find(".card-empty").text()).toBe(t("admin.dataAdapterNoIndices"));
  });

  it.each([
    ["a report without kind", { databaseProduct: "Elasticsearch", databaseVersion: "9.1.0", clusterName: "c", tagline: "x" }],
    ["a catalog report without kind", { ...postgresReport, kind: undefined }],
    ["a search report missing its indices", { ...searchReport, indices: undefined }],
  ])("%s is shown as a failed test, not a success or an empty catalog", async (_name, data) => {
    vi.mocked(adminApi.testDataAdapter).mockResolvedValueOnce({ success: true, data });
    const card = await mountCard(enterpriseAdapters, "elasticsearch", { elasticsearch: {} });
    await runTest(card);

    expect(card.find(".el-alert--success").exists()).toBe(false);
    expect(card.find("pre.adapter-test-message").text()).toBe(t("admin.dataAdapterInvalidReport"));
  });
});

/** Installed adapters of an edition with a graph adapter and the multi-source adapter (which has no connection of its own). */
const multiAdapters: DataAdapterInfo[] = [
  {
    type: "multi",
    label: "Multi-Source",
    requiresJoinFields: true,
    fields: [],
    examples: {},
  },
  {
    type: "neo4j",
    label: "Neo4j",
    requiresJoinFields: false,
    fields: ["url", "user", "password"],
    examples: { url: "bolt://host:7687", user: "neo4j" },
  },
  ...openSourceAdapters,
];

/** GET /admin/getSchema `data` (other fields trimmed): three classes and three relationships. */
const ontologySchema = {
  datasetDesc: "Sales",
  classDefs: [
    { name: "Person", showName: "Person", attrs: [] },
    { name: "Company", showName: "Company", attrs: [] },
    { name: "Order", showName: "Order", attrs: [] },
  ],
  relationshipDefs: {
    knows: { fromClass: "Person", toClass: "Person", desc: "", fromField: null, toField: null },
    works_at: { fromClass: "Person", toClass: "Company", desc: "", fromField: null, toField: null },
    placed: { fromClass: "Person", toClass: "Order", desc: "", fromField: "id", toField: "buyer" },
  },
};

/**
 * A saved definition: people and companies in a graph, orders in PostgreSQL. It still routes a class and names an
 * edge that the ontology no longer has; the graph connection carries a field Neo4j does not declare.
 */
const savedDefinition: MultiDataSourceDefinition = {
  dataSources: [
    {
      id: "graph",
      label: "Graph",
      adapterType: "neo4j",
      readOnly: false,
      connection: { url: "bolt://g:7687", user: "neo4j", password: "g-pw", company: "stale" },
    },
    {
      id: "sales",
      label: "Sales DB",
      adapterType: "postgresql",
      readOnly: true,
      connection: { url: "jdbc:postgresql://db/sales", user: "pg", password: "pg-pw" },
    },
  ],
  classes: [
    { forOntoMap: "Person", sourceId: "graph" },
    { forOntoMap: "Company", sourceId: "graph" },
    { forOntoMap: "Order", sourceId: "sales" },
    { forOntoMap: "Legacy", sourceId: "sales" },
  ],
  relationships: [
    { forOntoMap: "knows", realEdge: "KNOWS" },
    { forOntoMap: "gone", realEdge: "GONE" },
  ],
};

async function mountMulti(dataAdapter: string, connections: Record<string, DataAdapterConnection> = {}) {
  backend.multiDataSource = JSON.parse(JSON.stringify(savedDefinition));
  backend.schema = ontologySchema;
  const card = await mountCard(multiAdapters, dataAdapter, connections);
  await flushPromises();
  return card;
}

const entries = (card: Card) => card.findAll(".multi-source-entry");
const inputValues = (scope: ReturnType<Card["find"]>) =>
  scope.findAll("input.el-input__inner").map((input) => (input.element as HTMLInputElement).value);
const relationshipRow = (card: Card, name: string) => card.find(`tr[data-relationship="${name}"]`);
const saveButton = (card: Card) => card.find("button.el-button--primary");
const buttonIn = (scope: ReturnType<Card["find"]>, label: string) =>
  scope.findAll("button").find((button) => button.text() === label)!;

describe("the multi-source mode of the data adapter card", () => {
  it("selecting Multi-Source replaces the connection fields and connection test with data sources, class routing and relationships", async () => {
    const card = await mountMulti("postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });
    expect(card.find(".multi-source-section").exists()).toBe(false);
    expect(adminApi.getOntologyOutline).not.toHaveBeenCalled();

    await selectAdapter(card, "Multi-Source");
    await flushPromises();

    expect(card.findAll(".multi-source-heading").map((heading) => heading.text())).toEqual([
      t("admin.multiSourceDataSources"),
      t("admin.multiSourceClassRoutes"),
      t("admin.multiSourceRelationships"),
    ]);
    expect(card.findAll(".multi-source-table tbody tr").map((row) => row.find("td").text())).toEqual([
      "Person",
      "Company",
      "Order",
      "knows",
      "works_at",
      "placed",
    ]);
    // Only the per-source test buttons remain, one per data source.
    expect(card.findAll("button").filter((button) => button.text() === t("common.testConnection"))).toHaveLength(2);
    expect(vi.mocked(adminApi.getOntologyOutline)).toHaveBeenCalledTimes(1);
  });

  it("a domain that never saved a definition (multiDataSource: null) loads and opens the editor with an empty draft", async () => {
    backend.schema = ontologySchema;
    const card = await mountCard(multiAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });
    expect(card.find(".el-radio.is-checked").text()).toBe("PostgreSQL");

    await selectAdapter(card, "Multi-Source");
    await flushPromises();

    expect(entries(card)).toHaveLength(0);
    expect(card.find(".multi-source-section .card-empty").text()).toBe(t("admin.multiSourceNoSources"));
    expect(card.findAll(".multi-source-table tbody tr")).toHaveLength(6);
    expect(card.find(".multi-source-hint").exists()).toBe(false);
  });

  it("shows each saved source with its type's fields and examples; a new source starts without a type", async () => {
    const card = await mountMulti("multi");

    const [graph, sales] = entries(card);
    expect(inputValues(graph)).toEqual(["graph", "Graph", "bolt://g:7687", "neo4j", "g-pw"]);
    expect(graph.findAll("input.el-input__inner")[4].attributes("type")).toBe("password");
    expect(inputValues(sales)).toEqual(["sales", "Sales DB", "jdbc:postgresql://db/sales", "pg", "pg-pw"]);
    expect(graph.findAll("input.el-input__inner")[2].attributes("placeholder")).toBe("bolt://host:7687");
    expect((sales.find(".el-switch input").element as HTMLInputElement).checked).toBe(true);

    await card.find(".multi-source-add").trigger("click");
    const added = entries(card)[2];
    expect(inputValues(added)).toEqual(["", ""]);
    expect(buttonIn(added, t("common.delete"))).toBeTruthy();
    expect(added.findAll("button").some((button) => button.text() === t("common.testConnection"))).toBe(false);
  });

  it("offers the installed adapters other than Multi-Source as a source type", async () => {
    backend.multiDataSource = savedDefinition;
    backend.schema = ontologySchema;
    backend.adapters = multiAdapters;
    backend.dataAdapter = "multi";
    // The dropdown is teleported to the body; the select's input names it through aria-controls.
    const page = mount(SystemConfigPage, {
      global: pageGlobal(host, i18n),
      attachTo: document.body,
    });
    wrappers.push(page);
    await flushPromises();
    const graph = page.find(".multi-source-entry");
    await graph.find(".el-select__wrapper").trigger("click");
    await flushPromises();

    const list = document.getElementById(graph.find(".el-select input").attributes("aria-controls")!)!;
    expect([...list.querySelectorAll(".el-select-dropdown__item")].map((item) => item.textContent?.trim())).toEqual([
      "Neo4j",
      "PostgreSQL",
    ]);
    expect(graph.find(".el-select__selection").text()).toBe("Neo4j");
  });

  it("derives each relationship's source from its end classes: same-source graph relationships take an edge name, cross-source ones are marked", async () => {
    const card = await mountMulti("multi");

    const knows = relationshipRow(card, "knows");
    expect(knows.findAll("td")[1].text()).toBe("Person → Person");
    expect(knows.findAll("td")[2].text()).toBe("graph");
    expect((knows.find("input").element as HTMLInputElement).value).toBe("KNOWS");
    expect(knows.find("input").attributes("placeholder")).toBe("knows");

    const worksAt = relationshipRow(card, "works_at");
    expect(worksAt.findAll("td")[2].text()).toBe("graph");
    expect((worksAt.find("input").element as HTMLInputElement).value).toBe("");

    const placed = relationshipRow(card, "placed");
    expect(placed.find(".el-tag").text()).toBe(t("admin.multiSourceCrossSource"));
    expect(placed.findAll("td")[2].text()).toContain("graph → sales");
    expect(placed.find("input").exists()).toBe(false);
  });

  it("with a single data source, unrouted classes are shown falling back to it", async () => {
    const card = await mountMulti("multi");
    expect(card.find(".multi-source-hint").exists()).toBe(false);

    await buttonIn(entries(card)[1], t("common.delete")).trigger("click");

    expect(entries(card)).toHaveLength(1);
    expect(card.find(".multi-source-hint").text()).toBe(
      t("admin.multiSourceSingleFallback", { id: "graph" })
    );
  });

  it("tests one source with its type and only that type's fields, and shows the report on that source alone", async () => {
    const card = await mountMulti("multi");

    await buttonIn(entries(card)[0], t("common.testConnection")).trigger("click");
    await flushPromises();

    expect(backend.tested).toEqual([
      { type: "neo4j", url: "bolt://g:7687", user: "neo4j", password: "g-pw" },
    ]);
    expect(backend.multiUsed).toEqual([]);
    expect(backend.used).toEqual([]);
    expect(entries(card)[0].find(".adapter-test-result .el-alert--success").exists()).toBe(true);
    expect(entries(card)[1].find(".adapter-test-result").exists()).toBe(false);

    // The report describes the values it ran with: editing the source's connection hides it.
    await entries(card)[0].findAll("input.el-input__inner")[2].setValue("bolt://other:7687");
    expect(entries(card)[0].find(".adapter-test-result").exists()).toBe(false);
  });

  it("saves through useMultiDataSource only: every source, routes and non-blank edge names of the current ontology", async () => {
    const card = await mountMulti("multi");
    await relationshipRow(card, "works_at").find("input").setValue(" WORKS_AT ");
    await saveButton(card).trigger("click");
    await flushPromises();

    expect(backend.multiUsed).toEqual([
      {
        dataSources: savedDefinition.dataSources,
        classes: [
          { forOntoMap: "Person", sourceId: "graph" },
          { forOntoMap: "Company", sourceId: "graph" },
          { forOntoMap: "Order", sourceId: "sales" },
        ],
        relationships: [
          { forOntoMap: "knows", realEdge: "KNOWS" },
          { forOntoMap: "works_at", realEdge: "WORKS_AT" },
        ],
      },
    ]);
    expect(backend.used).toEqual([]);
    expect(card.find(".multi-source-failure").exists()).toBe(false);
  });

  it("a rejected save lists every located problem; a failure without problems shows its message", async () => {
    const card = await mountMulti("multi");
    const message = "Invalid multi-source configuration: a; b";
    vi.mocked(adminApi.useMultiDataSource).mockRejectedValueOnce(
      new PlatformBusinessError(message, {
        success: false,
        message,
        data: {
          problems: [
            { path: "dataSources[sales]", detail: "duplicate id" },
            { path: "relationship_rule[placed]", detail: "ends in different sources" },
          ],
        },
      })
    );
    await saveButton(card).trigger("click");
    await flushPromises();

    const failure = card.find(".multi-source-failure");
    expect(failure.text()).toContain(t("admin.multiSourceSaveRejected"));
    expect(
      failure.findAll(".multi-source-problems li").map((item) => [item.find("code").text(), item.find("span").text()])
    ).toEqual([
      ["dataSources[sales]", "duplicate id"],
      ["relationship_rule[placed]", "ends in different sources"],
    ]);

    vi.mocked(adminApi.useMultiDataSource).mockRejectedValueOnce(new Error("java down"));
    await saveButton(card).trigger("click");
    await flushPromises();

    expect(card.find(".multi-source-problems").exists()).toBe(false);
    expect(card.find(".multi-source-failure pre").text()).toBe("java down");

    await saveButton(card).trigger("click");
    await flushPromises();
    expect(card.find(".multi-source-failure").exists()).toBe(false);
  });

  it("the ontology failing to load shows the error with retry, and the multi-source save waits for it", async () => {
    vi.mocked(adminApi.getOntologyOutline).mockRejectedValueOnce(new Error("schema down"));
    const card = await mountMulti("multi");

    expect(card.find(".load-error").text()).toContain("schema down");
    expect(entries(card)).toHaveLength(2);
    expect(saveButton(card).attributes("disabled")).toBeDefined();

    await buttonIn(card.find(".load-error"), t("common.retry")).trigger("click");
    await flushPromises();

    expect(card.find(".load-error").exists()).toBe(false);
    expect(relationshipRow(card, "knows").exists()).toBe(true);
    expect(saveButton(card).attributes("disabled")).toBeUndefined();
  });

  it("the single-source save and test are unchanged, and switching modes keeps both drafts", async () => {
    const card = await mountMulti("multi", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });
    await entries(card)[0].findAll("input.el-input__inner")[1].setValue("Graph DB");

    await selectAdapter(card, "PostgreSQL");
    expect(card.find(".multi-source-section").exists()).toBe(false);
    expect(inputValues(card.find(".config-form"))).toEqual(["jdbc:postgresql://db/app", "pg", "secret"]);
    await card.find("input.el-input__inner").setValue("jdbc:postgresql://db/other");
    await runTest(card);
    await saveButton(card).trigger("click");
    await flushPromises();

    expect(backend.tested).toEqual([
      { type: "postgresql", url: "jdbc:postgresql://db/other", user: "pg", password: "secret" },
    ]);
    expect(backend.used).toEqual([
      { type: "postgresql", url: "jdbc:postgresql://db/other", user: "pg", password: "secret" },
    ]);
    expect(backend.multiUsed).toEqual([]);

    await selectAdapter(card, "Multi-Source");
    expect(inputValues(entries(card)[0]).slice(0, 2)).toEqual(["graph", "Graph DB"]);
    await saveButton(card).trigger("click");
    await flushPromises();

    expect(backend.used).toHaveLength(1);
    expect((backend.multiUsed[0] as MultiDataSourceDefinition).dataSources[0].label).toBe("Graph DB");
    expect(vi.mocked(adminApi.getOntologyOutline)).toHaveBeenCalledTimes(1);
  });
});
