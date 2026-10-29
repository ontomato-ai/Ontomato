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

it("discovers the built-in graph disabled by default and persists domain-specific overrides", async () => {
  let registry = await manager.forDomain("first");
  expect(registry.getSkillById("network-graph")?.isPublic).toBe(true);
  expect(registry.isSkillEnabled("network-graph")).toBe(false);
  expect(registry.getSkills().some(skill => skill.id === "network-graph")).toBe(false);
  expect(registry.isSkillEnabled("echarts")).toBe(true);
  registry.setSkillEnabled("network-graph", true);
  registry = await manager.forDomain("first");
  expect(registry.isSkillEnabled("network-graph")).toBe(true);
  expect((await manager.forDomain("second")).isSkillEnabled("network-graph")).toBe(false);
  registry.setSkillEnabled("network-graph", false);
  await registry.initialize();
  expect(registry.isSkillEnabled("network-graph")).toBe(false);
  registry.removeSkillState("network-graph");
  expect(registry.isSkillEnabled("network-graph")).toBe(false);
});
