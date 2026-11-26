import { beforeEach, expect, it, vi } from "vitest";
import { PAGE_OPERATOR_SKILL, runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migratePageOperatorSkill } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const skill = (name: string, provider = "workbench"): RuntimeSkillRef => ({
  namespace: { kind: "provider", provider }, name,
});
const oldRegular = [
  skill("ontomato-analyst-assistant", "ontology"),
  skill("assistant-report"),
  skill("echarts"),
  skill("leaflet"),
  skill("admin-choropleth-map"),
];
const oldGovernance = [skill("knowledge-governance", "ontology"), skill("assistant-report")];
const oldAppBuilder = [skill("ontomato-app-builder"), skill("application-design"), skill("dashboard-pages")];
const oldOps = [skill("ops-diagnosis")];

beforeEach(() => query.mockReset());

it("adds the operator only to unchanged shipped skill arrays and retires withdrawn presets", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "regular", kind: "regular", skills: oldRegular },
    { id: "custom-regular", kind: "regular", skills: [...oldRegular, skill("custom")] },
    { id: "governance", kind: "knowledge-governance", skills: oldGovernance },
    { id: "builder", kind: "app-builder", skills: oldAppBuilder },
    { id: "ops", kind: "ops-diagnosis", skills: oldOps },
    { id: "modeling", kind: "modeling", skills: oldRegular },
    { id: "product", kind: "product-layer", skills: oldRegular },
    { id: "admin", kind: "admin", skills: oldRegular },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migratePageOperatorSkill({ query } as unknown as QueryableClient))
    .toEqual({ presetsUpdated: 4, retiredPresetsDeleted: 3 });

  const updates = query.mock.calls.slice(1, 5);
  expect(updates.map(call => call[1][0])).toEqual(["regular", "governance", "builder", "ops"]);
  for (const call of updates) {
    const keys = JSON.parse(call[1][1]).map(runtimeSkillKey);
    expect(keys.at(-1)).toBe(runtimeSkillKey(PAGE_OPERATOR_SKILL));
    expect(keys.filter((key: string) => key === runtimeSkillKey(PAGE_OPERATOR_SKILL))).toHaveLength(1);
  }
  expect(query.mock.calls[5][1]).toEqual([["modeling", "product", "admin"]]);
});

it("leaves customized and already upgraded selections untouched", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "custom", kind: "regular", skills: [skill("custom")] },
    { id: "upgraded", kind: "ops-diagnosis", skills: [...oldOps, PAGE_OPERATOR_SKILL] },
  ] });

  expect(await migratePageOperatorSkill({ query } as unknown as QueryableClient))
    .toEqual({ presetsUpdated: 0, retiredPresetsDeleted: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
