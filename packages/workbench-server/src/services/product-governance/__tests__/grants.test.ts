import { beforeEach, expect, it, vi } from "vitest";
import { RETRIEVAL_AGENT_ID, type ProductGrantVerb } from "@ontomato/contracts/product-governance";
import { registerProductResource, setProductGrants } from "../grants";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  headers: vi.fn(() => ({ tk: "caller" })),
}));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: mocks.headers }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "service-token" }) },
}));

beforeEach(() => {
  mocks.post.mockReset();
  mocks.headers.mockClear();
});

it("registers ownerless shared resources through the authenticated product endpoint", async () => {
  mocks.post.mockResolvedValue({ text: '{"success":true}' });
  const options = {
    ownerId: null,
    verbs: ["use", "view", "edit"] satisfies ProductGrantVerb[],
  };
  await registerProductResource({ domainId: "domain" }, RETRIEVAL_AGENT_ID, true, options);
  expect(mocks.post).toHaveBeenCalledWith("product-grant-registration", "http://java.test/product-governance/register",
    { domainId: "domain", id: RETRIEVAL_AGENT_ID, shared: true, ...options },
    { headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "service-token" }, retries: 1 });
});

it("replaces a subject's grants under the caller credential, including revocation", async () => {
  mocks.post.mockResolvedValue({ text: '{"success":true}' });
  const input = { id: RETRIEVAL_AGENT_ID, principalKind: "role" as const, principalId: "reviewers", verbs: [] };
  await expect(setProductGrants({ token: "caller", locale: "en", apiKey: "key" }, input)).resolves.toEqual({ success: true });
  expect(mocks.headers).toHaveBeenCalledWith("caller", undefined, "en", "key");
  expect(mocks.post).toHaveBeenCalledWith("product-grant-set", "http://java.test/product-governance/grant-set", input,
    { headers: { tk: "caller" }, retries: 1 });
});
