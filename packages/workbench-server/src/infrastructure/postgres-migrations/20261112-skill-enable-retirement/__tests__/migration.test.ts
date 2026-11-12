import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { migrateSkillEnableRetirement, removeRetiredSkillStates, RETIRED_STATES_FILE } from "../migration";
import type { QueryableClient } from "../../helpers";

vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

/** A domain skills root as the retired rule left it: one directory per encoded domain ID. */
function domainsRoot(domains: Record<string, { states?: object; packages?: Record<string, string> }>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-retirement-"));
  roots.push(root);
  for (const [domainId, { states, packages = {} }] of Object.entries(domains)) {
    const directory = path.join(root, encodeURIComponent(domainId).replace(/\./g, "%2E"));
    fs.mkdirSync(directory);
    if (states) fs.writeFileSync(path.join(directory, RETIRED_STATES_FILE), JSON.stringify(states));
    for (const [name, metadata] of Object.entries(packages)) {
      fs.mkdirSync(path.join(directory, name));
      fs.writeFileSync(path.join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\nmetadata:\n${metadata}---\nBody\n`);
    }
  }
  return root;
}
const provider = (name: string) => ({ name, namespace: { kind: "provider", provider: "workbench" } });
const domainSkill = (domainId: string, name: string) => ({ name, namespace: { kind: "domain", domainId } });

it("removes from each agent exactly the skills its domain had switched off, by the retired rule", async () => {
  const root = domainsRoot({
    "a.example": {
      states: { disabledSkills: ["echarts", "own-off"], enabledSkills: ["network-graph"] },
      packages: { "own-off": "  author: x\n", "own-default-off": "  ontomato.defaultEnabled: \"false\"\n", "own-on": "  author: x\n" },
    },
  });
  const update = vi.fn();
  const client = { query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("UPDATE")) { update(params); return { rows: [] }; }
    return { rows: [
      { id: "1", domain_id: "a.example", skills: [provider("echarts"), provider("network-graph"), provider("leaflet"),
        domainSkill("a.example", "own-off"), domainSkill("a.example", "own-default-off"), domainSkill("a.example", "own-on")] },
      // A domain with no directory had only the packages' defaults.
      { id: "2", domain_id: "b", skills: [provider("echarts"), provider("network-graph")] },
      { id: "3", domain_id: "b", skills: [provider("echarts")] },
    ] };
  }) } as unknown as QueryableClient;

  expect(await migrateSkillEnableRetirement(client, root)).toEqual({ agents: 2 });
  expect(update.mock.calls.map(([params]) => [params[0], JSON.parse(params[1]).map((skill: { name: string }) => skill.name)])).toEqual([
    ["1", ["network-graph", "own-on"]],
    ["2", ["echarts"]],
  ]);
});

it("deletes the retired state file of every domain", () => {
  const root = domainsRoot({ a: { states: {} }, b: {} });
  removeRetiredSkillStates(root);
  expect(fs.existsSync(path.join(root, "a", RETIRED_STATES_FILE))).toBe(false);
  expect(fs.readdirSync(root).sort()).toEqual(["a", "b"]);
});
