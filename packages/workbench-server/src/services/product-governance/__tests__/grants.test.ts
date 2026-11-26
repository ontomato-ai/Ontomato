import { beforeEach, expect, it, vi } from "vitest";
import { RETRIEVAL_AGENT_ID, type ProductGrantVerb } from "@ontomato/contracts/product-governance";
import { readDomainProductGrants, registerProductResource, setProductGrants } from "../grants";

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

it("reads domain grants with optional filters and propagates authorization failures", async () => {
  const response = { grants: [{ resourceId: RETRIEVAL_AGENT_ID, principalKind: "domain", principalId: "*", verb: "use" }] };
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify(response) });
  await expect(readDomainProductGrants({ token: "caller" })).resolves.toEqual(response);
  const filter = { principalKind: "role" as const, principalId: "reviewers" };
  const denied = Object.assign(new Error("Forbidden"), { status: 403 });
  mocks.post.mockRejectedValueOnce(denied);
  await expect(readDomainProductGrants({ token: "caller" }, filter)).rejects.toBe(denied);
  expect(mocks.post.mock.calls.map(([, url, body, options]) => [url, body, options.headers])).toEqual([
    ["http://java.test/product-governance/domain-grants", {}, { tk: "caller" }],
    ["http://java.test/product-governance/domain-grants", filter, { tk: "caller" }],
  ]);
});
