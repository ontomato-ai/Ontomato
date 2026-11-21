import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { afterEach, expect, it, vi } from "vitest";

const { productCatalogServerOperations } = await import("../catalog-operations");
const save = productCatalogServerOperations.find(operation => operation.handlerRef === `${APPLICATION}.save`)!;

// The owner's refusal as Java sends it, longer than a backend call keeps by default.
const reason = "Entry 'entry-two' default agent '869d0f4e-9cc1-4176-9d12-496e1f0ad7cf' is disabled.";
const refusal = {
  message: reason, code: "PAGE_DEFAULT_AGENT_UNAVAILABLE", success: false,
  errors: [{ field: "/values/panelUses/1/defaultAgent", code: "target_unavailable", message: reason }],
};
const use = (id: string, agentId: string) => ({
  id, pageKey: id, panelId: `panel-${id}`, path: `/applications/app-one/${id}`, access: { kind: "domain-member" },
  defaultAgent: { kind: "id", id: agentId },
});

afterEach(() => { vi.unstubAllGlobals(); });

it("shows the owner's refusal of an entry's default agent at that entry's row", async () => {
  expect(JSON.stringify(refusal).length).toBeGreaterThan(200);
  const fetch = vi.fn(async () => new Response(JSON.stringify(refusal), { status: 409, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);

  const outcome = await save.execute(
    { executor: { owner: { domainId: "domain", userId: "reader" }, credentials: { token: "token", locale: "en" } } } as never,
    { kind: "object", objectType: APPLICATION, primaryKey: "app-one" } as never,
    { values: {
      entry: { path: "/applications/app-one", renderer: "panels" },
      panelUses: [use("entry-one", "8e617d7e-36ab-4a76-8f5b-c816c37decee"), use("entry-two", "869d0f4e-9cc1-4176-9d12-496e1f0ad7cf")],
    } }, "intent-one");

  expect(fetch).toHaveBeenCalledOnce();
  expect(outcome).toEqual({
    kind: "refusal", code: "PAGE_DEFAULT_AGENT_UNAVAILABLE", message: reason,
    errors: [{ field: "/panelUses/1/defaultAgent", code: "target_unavailable", message: reason }],
  });
});
