import { expect, it, vi } from "vitest";
import {
  applicationEntryRootsChangedSchema, entryDependencyChangeRequestSchema, type EntryDependency,
} from "@ontomato/contracts/entry-dependencies";
import { METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import { publishApplicationEntryRoots } from "../entry-dependency-publication";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  readPanels: vi.fn(),
  readBound: vi.fn(),
  saveBound: vi.fn(),
  deleteBound: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "workbench-service" }) },
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (action: (client: unknown) => Promise<void>) => action({}),
}));
vi.mock("../../../infrastructure/product-write-lock", () => ({ lockProducts: vi.fn() }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post }));
vi.mock("../entry-dependency-compiler", async original => ({
  ...await original<typeof import("../entry-dependency-compiler")>(),
  entryDependencyCompiler: () => mocks.compile,
}));
vi.mock("../entry-dependency-store", async original => ({
  ...await original<typeof import("../entry-dependency-store")>(),
  readPanelDependencies: mocks.readPanels,
  readBoundEntryDependencies: mocks.readBound,
  saveBoundEntryDependencies: mocks.saveBound,
  deleteBoundEntryDependencies: mocks.deleteBound,
}));

const dependency = (objectType: EntryDependency["objectType"], objectKey: string): EntryDependency =>
  ({ objectType, objectKey, verb: "USE" });
const metric = (primaryKey: string) => ({ literal: { className: METRIC_VIEW, primaryKey } });

it("publishes the literal-only delta and keeps a distinct unbound frame placement", async () => {
  const panel = dependency("PANEL", "shared");
  const previous = dependency("METRIC", "old-metric");
  const added = dependency("METRIC", "new-metric");
  const frameDefault = dependency("METRIC", "frame-default");
  const root = { panelIds: ["shared"], agentIds: [] };
  const before = { panelId: "shared", inputs: { metric: metric("old-metric") }, alsoUnbound: true };
  const after = { ...before, inputs: { metric: metric("new-metric") } };
  mocks.readPanels.mockResolvedValue(new Map([["shared", [panel, frameDefault]]]));
  mocks.readBound.mockResolvedValue(new Map([["app/orders", { ...before, dependencies: [panel, previous] }]]));
  mocks.compile.mockResolvedValue([panel, added]);
  mocks.post.mockResolvedValue({ text: JSON.stringify({ success: true }) });

  await publishApplicationEntryRoots(applicationEntryRootsChangedSchema.parse({
    type: "application.entry-roots.changed", sequence: "2", occurredAt: "2026-11-26T00:00:00Z",
    domainId: "domain", actorId: "author", entryId: "app/orders",
    before: { ...root, boundPanelRoot: before }, after: { ...root, boundPanelRoot: after },
  }));

  expect(mocks.compile).toHaveBeenCalledTimes(1);
  expect(mocks.compile).toHaveBeenCalledWith("shared", after.inputs);
  expect(mocks.saveBound).toHaveBeenCalledWith(expect.anything(), "domain", "app/orders", after, [panel, added]);
  const publication = entryDependencyChangeRequestSchema.parse(mocks.post.mock.calls[0][2]);
  expect(publication.entries).toEqual([{
    entryId: "app/orders", before: [frameDefault, previous, panel], after: [frameDefault, added, panel],
  }]);
});
