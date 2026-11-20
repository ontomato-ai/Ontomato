import { afterEach, expect, it, vi } from "vitest";
import { dashboardMetricOutputSchema } from "@ontomato/contracts/dashboard";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { createMetricReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

/*
 * The metric result read: the reader's credentials and language reach the owner, the metric runs at the revision its
 * description names with the named parameter values (a chosen object by its primary key), the owner's output comes
 * back as it is, and the owner's refusals stay the owner's, with its status and words.
 */

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "zh-CN" };
const description = {
  id: "m1", revision: "rev-7", status: "PUBLISHED", name: "Revenue by customer",
  parameterDefs: [{ name: "customerId", type: "TYPE_STRING" }, { name: "year", type: "TYPE_NUMBER" }],
  outputColumns: [{ key: "month", label: "Month", type: null }, { key: "revenue", label: "Revenue", type: null }],
  sourceObjectTypes: ["Order"],
};
const output = {
  columns: description.outputColumns,
  rows: [{ month: "2026-01", revenue: 120 }, { month: "2026-02", revenue: 95 }],
  truncation: { truncated: true, rowLimit: 2, truncationHint: "Narrow the date range" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function ownerAnswering(execute: (body: Record<string, unknown>) => Response) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    expect(headers.get("tk")).toBe(viewer.token);
    expect(headers.get("Accept-Language")).toBe(viewer.locale);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ path, body });
    if (init.method === "POST" && path === "/ontology/query/metrics/describe") return Response.json(description);
    if (init.method === "POST" && path === "/ontology/query/metrics/execute") return execute(body);
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  }));
  return sent;
}

it("runs the selected metric as the reader at its described revision and answers the owner's output", async () => {
  const sent = ownerAnswering(() => Response.json(output));

  const result = await createMetricReadAdapter(owner, viewer).result("m1", {
    customerId: { className: "Customer", primaryKey: "c-42" }, year: 2026,
  });

  expect(dashboardMetricOutputSchema.parse(result)).toEqual(output);
  expect(sent).toEqual([
    { path: "/ontology/query/metrics/describe", body: { id: "m1" } },
    { path: "/ontology/query/metrics/execute", body: { id: "m1", revision: "rev-7", parameters: { customerId: "c-42", year: 2026 } } },
  ]);
});

it("runs a metric without parameters with none", async () => {
  const sent = ownerAnswering(() => Response.json({ ...output, rows: [], truncation: null }));

  expect(await createMetricReadAdapter(owner, viewer).result("m1", {}))
    .toEqual({ columns: description.outputColumns, rows: [], truncation: null });
  expect(sent[1]?.body).toEqual({ id: "m1", revision: "rev-7", parameters: {} });
});

it("keeps the owner's refusal with its status and words, and runs a failed metric once", async () => {
  const cases: [number, string][] = [
    [400, "Missing parameter: customerId"],
    [403, "Field is outside the authorized scope"],
    [404, "Executable read metric not found"],
    [409, "Metric specification changed; retrieve it again"],
    [500, "Python execution failed"],
  ];
  for (const [status, message] of cases) {
    const sent = ownerAnswering(() => Response.json({ error: { code: "ONTOLOGY_QUERY_FAILED", message } }, { status }));

    const refusal = await createMetricReadAdapter(owner, viewer).result("m1", { year: 2026 }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({ status, message });
    expect(sent.filter(request => request.path.endsWith("/execute"))).toHaveLength(1);
    vi.unstubAllGlobals();
  }
});
