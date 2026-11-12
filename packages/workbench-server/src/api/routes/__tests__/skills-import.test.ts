import express from "express";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
import router from "../skills";

vi.mock("../../../i18n", () => ({ t: (key: string) => key, tApp: (key: string) => key }));
vi.mock("../../../services/skills/render-view", () => ({ renderObjectView: vi.fn() }));

vi.mock("../../../identity/installed", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../../services/skills/skill-manager", () => ({
  skillManager: { importSkill: vi.fn(async () => {
    throw new HttpError(409, "Skill already exists: example", "SKILL_EXISTS", { skillId: "example" });
  }) },
}));

it("returns the conflicting skill ID through the import HTTP boundary", async () => {
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { domainId: "test-domain" }); next(); });
  app.use(router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as import("node:net").AddressInfo;
    const body = new FormData();
    body.append("file", new Blob(["fixture"]), "skill.zip");
    const response = await fetch(`http://127.0.0.1:${address.port}/import`, { method: "POST", body });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SKILL_EXISTS", details: { skillId: "example" } });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
