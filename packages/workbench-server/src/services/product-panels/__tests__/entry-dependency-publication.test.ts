import { expect, it, vi } from "vitest";
import {
  applicationEntryRootsChangedSchema, entryDependencyChangeRequestSchema, type EntryDependency,
} from "@ontomato/contracts/entry-dependencies";
import { METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import { deliverEntryDependencyPublications, publishApplicationEntryRoots } from "../entry-dependency-publication";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  readPanels: vi.fn(),
  readBound: vi.fn(),
  saveBound: vi.fn(),
  deleteBound: vi.fn(),
  post: vi.fn(),
  query: vi.fn(),
}));
vi.mock("../../../config/environment", () => ({
  environment: { pgSchema: () => "test", agentRuntime: () => ({ queryServiceToken: "workbench-service" }) },
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (action: (client: unknown) => Promise<void>) => action({ query: mocks.query }),
}));
vi.mock("../../../infrastructure/product-write-lock", () => ({ lockProducts: vi.fn() }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post }));
vi.mock("../entry-dependency-compiler", async original => ({
  ...await original<typeof import("../entry-dependency-compiler")>(),
  entryDependencyCompiler: () => mocks.compile,
}));
vi.mock("../entry-dependency-store", async original => ({
  ...await original<typeof import("../entry-dependency-store")>(),
  readCompiledPanelDependencies: mocks.readPanels,
  readBoundEntryDependencies: mocks.readBound,
  saveBoundEntryDependencies: mocks.saveBound,
  deleteBoundEntryDependencies: mocks.deleteBound,
}));
vi.mock("../object-detail", () => ({ listObjectDetailPanelMappings: async () => [] }));

const dependency = (objectType: EntryDependency["objectType"], objectKey: string): EntryDependency =>
  ({ objectType, objectKey, verb: "USE" });
const metric = (primaryKey: string) => ({ literal: { className: METRIC_VIEW, primaryKey } });

it("publishes the literal-only delta and keeps a distinct unbound frame placement", async () => {
  mocks.post.mockClear();
  const panel = dependency("PANEL", "shared");
  const previous = dependency("METRIC", "old-metric");
  const added = dependency("METRIC", "new-metric");
  const frameDefault = dependency("METRIC", "frame-default");
  const root = { panelIds: ["shared"], agentIds: [] };
  const before = { panelId: "shared", inputs: { metric: metric("old-metric") }, alsoUnbound: true };
  const after = { ...before, inputs: { metric: metric("new-metric") } };
  mocks.readPanels.mockResolvedValue(new Map([["shared", { dependencies: [panel, frameDefault] }]]));
  mocks.readBound.mockResolvedValue(new Map([["app/orders", { ...before, dependencies: [panel, previous] }]]));
  mocks.compile.mockResolvedValue({ dependencies: [panel, added] });
  mocks.post.mockResolvedValue({ text: JSON.stringify({ success: true }) });

  await publishApplicationEntryRoots(applicationEntryRootsChangedSchema.parse({
    type: "application.entry-roots.changed", sequence: "2", occurredAt: "2026-11-26T00:00:00Z",
    domainId: "domain", actorId: "author", entryId: "app/orders",
    before: { ...root, boundPanelRoot: before }, after: { ...root, boundPanelRoot: after },
  }));

  expect(mocks.compile).toHaveBeenCalledTimes(1);
  expect(mocks.compile).toHaveBeenCalledWith("shared", after.inputs);
  expect(mocks.saveBound).toHaveBeenCalledWith(expect.anything(), "domain", "app/orders", after, { dependencies: [panel, added] });
  const publication = entryDependencyChangeRequestSchema.parse(mocks.post.mock.calls[0][2]);
  expect(publication.entries).toEqual([{
    entryId: "app/orders", before: [frameDefault, previous, panel], after: [frameDefault, added, panel],
  }]);
});

it("publishes a saved panel dependency change only for its affected entry", async () => {
  mocks.post.mockClear();
  const content = dependency("PANEL", "content");
  const before = dependency("METRIC", "old");
  const after = dependency("METRIC", "new");
  const roots = { panelIds: ["content"], agentIds: [] };
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify({ success: true, data: { entries: [{ entryId: "app/use", roots }] } }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ success: true }) });
  mocks.readPanels.mockResolvedValue(new Map([["content", { dependencies: [after, content] }]]));
  mocks.readBound.mockResolvedValue(new Map());
  mocks.query.mockResolvedValueOnce({ rows: [{ dependency_sequence: "2", dependency_change: {
    source: { kind: "panel", id: "content", actorId: "author" },
    panels: [{ panelId: "content", before: [before, content], after: [after, content] }],
  } }] });
  await deliverEntryDependencyPublications("domain");
  const publication = entryDependencyChangeRequestSchema.parse(mocks.post.mock.calls[1][2]);
  expect(publication.entries).toEqual([{ entryId: "app/use", before: [before, content], after: [after, content] }]);
});
