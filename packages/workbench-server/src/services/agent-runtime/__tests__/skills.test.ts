import { afterEach, expect, it, vi } from "vitest";
import { publishOntologySkill } from "../skills";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("publishes an ontology skill as JSON with the workbench service headers", async () => {
  vi.stubEnv("DATA_QUERY_BASE_URL", "http://ontology.test");
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "test-service-token");
  const skill = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
  const version = { skill, digest: "a".repeat(64) };
  const fetchRequest = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
    async () => Response.json(version),
  );
  vi.stubGlobal("fetch", fetchRequest);

  await publishOntologySkill("domain-1", skill.name);

  const request = new Request(...fetchRequest.mock.calls[0]);
  expect(request.headers.get("content-type")).toBe("application/json");
  expect(request.headers.get("x-ontomato-query-service-token")).toBe("test-service-token");
  expect(request.headers.get("x-domain-id")).toBe("domain-1");
  expect(await request.json()).toEqual({ name: skill.name });
});
