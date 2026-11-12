import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "network-skill-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.resolve("skills") });
const { DomainSkillRegistryManager } = await import("../registry/manager");
const manager = new DomainSkillRegistryManager();
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it("lists the built-in graph as a public skill in every domain", async () => {
  for (const domain of ["first", "second"]) {
    const registry = await manager.forDomain(domain);
    expect(registry.getSkillById("network-graph")?.isPublic).toBe(true);
    expect(registry.getSkills().some(skill => skill.id === "network-graph")).toBe(true);
  }
});
