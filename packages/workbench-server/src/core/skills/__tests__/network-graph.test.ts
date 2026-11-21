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
    const registry = await manager.forDomain(domain, undefined, {});
    expect(registry.getSkillById("network-graph")?.source.kind).toBe("public");
    expect(registry.getSkillByRef({ namespace: { kind: "provider", provider: "workbench" }, name: "network-graph" })?.source.kind).toBe("public");
    expect(registry.getSkills().some(entry => entry.skill.name === "network-graph")).toBe(true);
  }
});
