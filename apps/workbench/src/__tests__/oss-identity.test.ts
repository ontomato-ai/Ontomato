import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkbenchIdentity, workbenchIdentity } from "@ontomato/workbench-server";
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

  it("requires the platform service credential to maintain a deployment", () => {
    vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "deployment-fixture");
    const unavailable = vi.fn();
    workbenchIdentity().requireDeploymentMaintenance({ header: () => undefined } as never, {} as never, unavailable);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    const allowed = vi.fn();
    const request = { header: (name: string) => name === "X-Ontomato-Query-Service-Token" ? "deployment-fixture" : undefined };
    workbenchIdentity().requireDeploymentMaintenance(request as never, {} as never, allowed);
    expect(allowed).toHaveBeenCalledWith();
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
