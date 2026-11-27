import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../../product-governance/service-authentication", async original => ({
  ...await original<typeof import("../../product-governance/service-authentication")>(),
  productGovernanceServiceHeaders: vi.fn(() => ({})),
}));
vi.mock("../../../utils/backend-client", () => ({
  backendPost: mocks.post,
  buildBackendHeaders: vi.fn(() => ({})),
}));

const viewer = { userId: "reader", domainId: "tenant" };
const source = { kind: "registered" as const, applicationId: "app", useId: "use" };
const registration = { panelId: "panel", framePanelId: null, inputs: {} };
const read = {
  source, registration, uses: [],
  call: { type: "platform:ObjectType", name: "options", parameters: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
});

it("sends each identical read item once and expands its result back to every placement", async () => {
  const { readViaJava } = await import("../java-panel-reads");
  const ready = { status: "ready", payload: [{ className: "Customer" }] };
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify({ viewer, results: [ready] }) });

  await expect(readViaJava(viewer, [read, read], { token: "token" })).resolves.toEqual({
    viewer, results: [ready, ready],
  });
  expect(mocks.post.mock.calls[0][2].reads).toHaveLength(1);
});

it("keeps otherwise identical reads separate when their USE admissions differ", async () => {
  const { readViaJava } = await import("../java-panel-reads");
  const ready = { status: "ready", payload: [] };
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify({ viewer, results: [ready, ready] }) });
  const admitted = {
    ...read,
    uses: [{ target: { kind: "PROJECTION" as const, id: "projection", domainId: "tenant" }, ownerFacts: { ownerId: "author", state: "PUBLISHED" as const } }],
  };

  await readViaJava(viewer, [read, admitted], { token: "token" });
  expect(mocks.post.mock.calls[0][2].reads).toHaveLength(2);
});
