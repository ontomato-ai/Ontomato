import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkbenchIdentity, workbenchIdentity } from "@ontomato/workbench-server";
import { requirePermission } from "@ontomato/workbench-server/identity/installed";
import { ossIdentity } from "../identity";

beforeEach(() => {
  installWorkbenchIdentity(ossIdentity);
});

describe("oss identity", () => {
  it("allows feedback through the installed permission guard without any credential", () => {
    const next = vi.fn();
    requirePermission(["user-feedback"])({} as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 1 for every domain check and ignores the supplied domain", () => {
    expect(workbenchIdentity().requireDomainId({ domainId: "other" })).toBe("1");
    expect(workbenchIdentity().requireDomainId({})).toBe("1");
  });

  it("keeps MCP on system/1 and autotest on the run domain", async () => {
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
    ).resolves.toEqual({ userId: "system", domainId: "run-domain" });
  });
});
