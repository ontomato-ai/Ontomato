import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryPackageSchema } from "@ontomato/contracts/query-package";
import { datasetPayloadSchema, prepareDatasetSchema } from "@ontomato/contracts/data-retrieval";
import { projectDataset } from "../dataset-projection";
import { normalizeAbcProgram, buildAbcProgramQueryPayload } from "../../dashboard/abc-program";

const bundle = JSON.parse(readFileSync(new URL("../../../../../contracts/examples/query-packages.json", import.meta.url), "utf8")).pythonAggregate;
const graph = {
  schema: "ontomato.query-subgraph.v1", queries: [], filters: [],
  nodes: [{ id: "one", kind: "operation", queryId: null, operation: "constant", expression: "1", label: "1" },
    { id: "out", kind: "output", key: "total", label: "Total" }],
  edges: [{ id: "value", kind: "dependency", source: "one", target: "out", role: "value", label: "" }],
};
const common = {
  title: "Total", question: "Total?", columns: [{ key: "total", label: "Total", type: null }],
  rows: [{ total: 0 }, { total: null }, { total: false }], truncation: null,
  assumptions: [], decisionIds: [], metricUses: [], selfCheck: null,
  execution: { receiptId: "00000000-0000-4000-8000-000000000001", executedAt: "2026-11-04T00:00:00Z" },
};
const check = { scope: "Authorized employees", filters: "Threshold", grain: "One total", denominator: "", nullGroups: "", comparisons: [] };
describe("query package wire boundaries", () => {
  it("uses the Java fixture and rejects incomplete, duplicate or escaping bundles", () => {
    expect(queryPackageSchema.parse(bundle)).toEqual(bundle);
    expect(queryPackageSchema.safeParse({ ...bundle, files: bundle.files.slice(1) }).success).toBe(false);
    expect(queryPackageSchema.safeParse({ ...bundle, files: [...bundle.files, bundle.files[0]] }).success).toBe(false);
    const escaping = structuredClone(bundle); escaping.files[0].path = "../outside.json";
    expect(queryPackageSchema.safeParse(escaping).success).toBe(false);
  });
  it("reads immutable v1 snapshots but only accepts package or metric submissions", () => {
    const legacy = { ...common, schema: "workbench.dataset.v1", recipe: { kind: "python", code: "old exact source", sha256: "old" },
      outKeyRefs: [{ key: "total", className: "/Employee", attrName: "salary", asGroupBy: false, statCal: true }] };
    expect(datasetPayloadSchema.parse(legacy)).toEqual(legacy);
    expect(prepareDatasetSchema.safeParse({ ...legacy, selfCheck: check }).success).toBe(false);
    expect(prepareDatasetSchema.parse({ recipe: { kind: "package", package: bundle, parameters: {}, columnLabels: { total: "Total" } },
      title: "Total", assumptions: [], metricUses: [], selfCheck: check }).recipe.kind).toBe("package");
    expect(datasetPayloadSchema.safeParse({ ...legacy, schema: "workbench.dataset.v2" }).success).toBe(false);
  });
  it("keeps old metric text only at the v1 read boundary and rejects it in v2", () => {
    const historical = { ...common, schema: "workbench.dataset.v1", sourceAnalysis: graph,
      recipe: { kind: "metric", metricId: "old", revision: "old", parameters: { threshold: 35 }, executedCode: "archived source" } };
    const old = datasetPayloadSchema.parse(historical);
    expect(projectDataset("old", old, { retrievalId: "r", runtimeSessionId: "s", runtimeRunId: "u" }).abcProgram?.code).toBe("archived source");
    expect(datasetPayloadSchema.safeParse({ ...historical, schema: "workbench.dataset.v2" }).success).toBe(false);
  });
  it("retains an opaque legacy Function source and its actual values without inventing a query package", () => {
    const legacySource = { manifest: { schema: "ontomato.query-source.legacy",
      entry: { kind: "python", path: "legacy.py" }, queries: {}, modules: [], parameterDefs: [], parameterBindings: [] },
      files: [{ path: "legacy.py", content: "from query_runtime import parameters\nprint(parameters)" }] };
    const payload = datasetPayloadSchema.parse({ ...common, schema: "workbench.dataset.v2", sourceAnalysis: graph,
      recipe: { kind: "metric", metricId: "old", revision: "revision", parameters: { threshold: 35 }, legacySource } });
    expect(datasetPayloadSchema.safeParse({ ...payload, recipe: { ...payload.recipe, package: bundle } }).success).toBe(false);
    const projected = projectDataset("old", payload, { retrievalId: "r", runtimeSessionId: "s", runtimeRunId: "u" });
    const normalized = normalizeAbcProgram(projected.abcProgram)!;
    expect(normalized.queryPackage).toBeUndefined();
    expect(normalized.code).toBe(legacySource.files[0]!.content);
    expect(buildAbcProgramQueryPayload(normalized).parameterValues).toEqual({ threshold: 35 });
  });
  it("keeps the whole executed package and values through history projection and dashboard refresh", () => {
    const payload = datasetPayloadSchema.parse({ ...common, schema: "workbench.dataset.v2", sourceAnalysis: graph,
      recipe: { kind: "package", package: bundle, parameters: { threshold: 35 }, columnLabels: { total: "Total" },
        packageSha256: "package", executionInputSha256: "execution" } });
    const projected = projectDataset("dataset", payload, { retrievalId: "retrieval", runtimeSessionId: "session", runtimeRunId: "run" });
    expect(projected.data).toEqual(common.rows);
    expect(projected.dsl).toBeUndefined();
    expect(projected.abcProgram?.queryPackage).toEqual(bundle);
    const program = normalizeAbcProgram(projected.abcProgram)!;
    expect(program.queryPackage).toEqual(bundle);
    expect(program.parameterValues).toEqual({ threshold: 35 });
    const request = buildAbcProgramQueryPayload(program, [{ key: "threshold", type: "TYPE_NUMBER", value: 40 }]);
    expect(request.queryPackage).toEqual(bundle);
    expect(request.code).toBeUndefined();
    expect(request.sourceAnalysis).toEqual(graph);
    expect(request.parameters[0]?.value).toBe(40);
  });
});
