import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkbenchIdentity, workbenchIdentity } from "@ontomato/workbench-server";
import { expectComponentPackageMaintenance } from "@ontomato/workbench-server/__tests__/fixtures/component-packages";
import { assertPermission, requirePermission } from "@ontomato/workbench-server/identity/installed";
import { ossIdentity } from "../identity";

beforeEach(() => {
  installWorkbenchIdentity(ossIdentity);
});
afterEach(() => void vi.unstubAllEnvs());

describe("oss identity", () => {
  it("allows feedback through the installed permission guard without any credential", async () => {
    const next = vi.fn();
    requirePermission(["user-feedback"])({} as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
    await expect(workbenchIdentity().assertPermission({}, ["analysis-agent"])).resolves.toBeUndefined();
    await expect(assertPermission({}, ["analysis-agent"])).resolves.toBeUndefined();
  });

  it("returns 1 for every domain check and ignores the supplied domain", () => {
    expect(workbenchIdentity().requireDomainId({ domainId: "other" })).toBe("1");
    expect(workbenchIdentity().requireDomainId({})).toBe("1");
  });

  it("installs a component package only with the deployment credential", async () => {
    vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "deployment-fixture");
    await expectComponentPackageMaintenance(ossIdentity, { "X-Ontomato-Query-Service-Token": "deployment-fixture" }, [{}]);
  });

  it("keeps MCP and scheduled test actors on system/1 despite declared domains", async () => {
    const req = { header: () => "secret", query: { apiKey: "secret" } } as never;
    await expect(workbenchIdentity().resolveMcpCaller(req, "tool-key")).resolves.toEqual({
      userId: "system",
      domainId: "1",
    });
    await expect(
      workbenchIdentity().resolveAutotestActor({ token: "", domainId: "" })
    ).resolves.toEqual({ userId: "system", domainId: "1" });
    await expect(
      workbenchIdentity().resolveAutotestActor({ token: "tk", domainId: "run-domain" })
    ).resolves.toEqual({ userId: "system", domainId: "1" });
  });
});
