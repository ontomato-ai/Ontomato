import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendPost } from "../../../utils/backend-client";
import { currentDefinitionAccess } from "../access";

vi.mock("../../../utils/backend-client", () => ({
  backendPost: vi.fn(),
  buildBackendHeaders: vi.fn(),
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "workbench" }) } }));

const ownerDomain = "domain";
const credentials = { token: "member" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("current definition access", () => {
  it("uses the owner's builtin row without a policy decision or edit admission", async () => {
    const builtin = { id: "builtin-product-example", domainId: null, ownerId: null };
    const access = await currentDefinitionAccess("panel", [builtin], ownerDomain, credentials);
    expect(access).toEqual({ decisions: [{ allowed: true }], editable: new Set() });
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("does not infer fixed admission from a domain object's ID", async () => {
    const denied = { allowed: false, code: "OBJECT_FORBIDDEN", reason: "No permission" };
    vi.mocked(backendPost).mockResolvedValue({ text: JSON.stringify({ decisions: [denied, { allowed: true }] }) } as Awaited<ReturnType<typeof backendPost>>);
    const fixed = { id: "builtin-product-fixed", domainId: null, ownerId: null };
    const domain = { id: "builtin-product-domain", domainId: ownerDomain, ownerId: "author" };
    const access = await currentDefinitionAccess("projection", [fixed, domain], ownerDomain, credentials);
    expect(access).toEqual({ decisions: [{ allowed: true }, denied], editable: new Set([domain.id]) });
    const target = { id: domain.id, domainId: ownerDomain, kind: "PROJECTION" };
    const ownerFacts = { ownerId: "author", state: "PUBLISHED" };
    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(backendPost).toHaveBeenCalledWith("object-authorization-decide-batch", expect.any(String), {
      requests: [{ target, ownerFacts, verb: "USE" }, { target, ownerFacts, verb: "EDIT" }],
    }, expect.anything());
  });

  it("does not turn a query runtime grant into ordinary builtin use", async () => {
    const builtin = { id: "builtin-product-example", domainId: null, ownerId: null };
    await expect(currentDefinitionAccess("panel", [builtin], ownerDomain, { token: "oq.runtime.grant" }))
      .rejects.toMatchObject({ status: 401 });
    expect(backendPost).not.toHaveBeenCalled();
  });
});
