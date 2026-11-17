import { beforeEach, expect, it, vi } from "vitest";
import { defaultAssistantSkills } from "../../../../config/assistant-defaults";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import shippedPrompts from "../defaults.json" with { type: "json" };
import { migrateAssistantChartSkills } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));
const previousSkills = [
  { name: "ontomato-analyst-assistant", namespace: { provider: "ontology", kind: "provider" } },
  { name: "assistant-report", namespace: { provider: "workbench", kind: "provider" } },
];
beforeEach(() => query.mockReset());

it("upgrades only shipped prompt and skill values across built-in agents and domains", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "english", kind: "regular", system_prompt: `\n${shippedPrompts.regular[0]}\n`, skills: previousSkills },
    { id: "localized", kind: "analysis", system_prompt: shippedPrompts.analysis[1], skills: previousSkills },
    { id: "code", kind: "regular", system_prompt: null, skills: previousSkills },
    { id: "custom", kind: "regular", system_prompt: "My instructions", skills: [] },
    { id: "custom-skills", kind: "analysis", system_prompt: null, skills: [...previousSkills, { name: "extra", namespace: { kind: "provider", provider: "workbench" } }] },
  ] }).mockResolvedValue({ rowCount: 1 });
  expect(await migrateAssistantChartSkills({ query } as unknown as QueryableClient))
    .toEqual({ promptsCleared: 2, skillsUpdated: 3 });
  expect(query.mock.calls[1]).toEqual([expect.stringContaining("system_prompt=NULL"), [["english", "localized"]]]);
  const [ids, encoded] = query.mock.calls[2][1];
  expect(ids).toEqual(["english", "localized", "code"]);
  const keys = JSON.parse(encoded).map(runtimeSkillKey);
  for (const name of ["echarts", "leaflet", "admin-choropleth-map"])
    expect(keys).toContain(runtimeSkillKey({ name, namespace: { kind: "provider", provider: "workbench" } }));
});

it("leaves customized or already upgraded rows untouched", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "custom", kind: "regular", system_prompt: "My instructions", skills: [] },
    { id: "upgraded", kind: "regular", system_prompt: null, skills: defaultAssistantSkills },
  ] });
  expect(await migrateAssistantChartSkills({ query } as unknown as QueryableClient))
    .toEqual({ promptsCleared: 0, skillsUpdated: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
