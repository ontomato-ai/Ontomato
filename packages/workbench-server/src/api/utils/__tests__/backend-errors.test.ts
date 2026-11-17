import { afterEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { DashboardMetricClient } from "../../../services/dashboard/metric-client";
import { OntologyRetrievalClient } from "../../../services/assistant/ontology-retrieval";
import { assertAppBuilderAccess } from "../../../services/app-builder/access";
import { WorkspaceBuildTests } from "../../../services/app-builder/build-tests";
import { wrap } from "../agent-host";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://engine" } } }));
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("backend refusals at HTTP consumers", () => {
  const owner = { domainId: "domain", userId: "limited" };
  const retrieval = new OntologyRetrievalClient(owner, "caller");
  it.each([
    ["metric", () => new DashboardMetricClient("domain", {}).describe("metric")],
    ["retrieval JSON", () => retrieval.links()],
    ["retrieval SSE", () => retrieval.events("session", "run", { seq: 0, streamId: "stream" }, new AbortController().signal)],
    ["application admission", () => assertAppBuilderAccess({})],
    ["build test", () => new WorkspaceBuildTests(owner, {}, "workspace").java("GET", "/current")],
  ] as const)("keeps the Java refusal through %s and the agent-host HTTP boundary", async (_name, operation) => {
    const message = "Operation permission is required: /protected/read";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, code: 403, message }, { status: 403 })));
    const response = await new Promise<{ status: number; body: unknown }>((resolve) => {
      let status = 0;
      const res = { status(value: number) { status = value; return this; }, json(body: unknown) { resolve({ status, body }); } };
      wrap(async () => { await operation(); throw new Error("Refusal was accepted"); })({} as never, res as never, () => {});
    });
    expect(response).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN", message } } });
  });

  it.each([[404, "METRIC_UNAVAILABLE"], [409, "METRIC_SPEC_CHANGED"]])("keeps the metric-specific HTTP %i mapping", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "SOURCE_ERROR", message: "Metric changed" } }, { status: Number(status) })));
    await expect(new DashboardMetricClient("domain", {}).describe("metric")).rejects.toMatchObject({ status, code, message: "Metric changed" });
  });

});
