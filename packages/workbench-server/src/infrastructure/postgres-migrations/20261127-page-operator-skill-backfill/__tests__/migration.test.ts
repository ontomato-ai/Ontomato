import { beforeEach, expect, it, vi } from "vitest";
import { PAGE_OPERATOR_SKILL, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migratePageOperatorSkill } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const skill = (name: string, provider = "workbench"): RuntimeSkillRef => ({
  namespace: { kind: "provider", provider }, name,
});
const client = () => ({ query }) as unknown as QueryableClient;
const updatePayload = (call: unknown[]) => JSON.parse((call[1] as unknown[])[1] as string) as RuntimeSkillRef[];

beforeEach(() => query.mockReset());

it("adds the operator to every preset row without rewriting other skills and retires withdrawn presets", async () => {
  const regularSkills = [skill("custom-entry"), skill("ontomato-analyst-assistant", "ontology")];
  const governanceSkills = [skill("knowledge-governance", "ontology")];
  const appBuilderSkills = [skill("ontomato-app-builder")];
  const opsSkills = [skill("ops-diagnosis"), skill("custom-ops")];
  query.mockResolvedValueOnce({ rows: [
    { id: "regular", kind: "regular", skills: regularSkills },
    { id: "governance", kind: "knowledge-governance", skills: governanceSkills },
    { id: "builder", kind: "app-builder", skills: appBuilderSkills },
    { id: "ops", kind: "ops-diagnosis", skills: opsSkills },
    { id: "analysis", kind: "analysis", skills: [skill("ontomato-analyst-assistant", "ontology")] },
    { id: "modeling", kind: "modeling", skills: [] },
    { id: "admin", kind: "admin", skills: [] },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migratePageOperatorSkill(client()))
    .toEqual({ presetsUpdated: 4, userAgentsUpdated: 0, analysisRowsUpdated: 0, retiredPresetsDeleted: 2 });

  const updates = new Map(query.mock.calls.slice(1, 5).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("regular")).toEqual([...regularSkills, PAGE_OPERATOR_SKILL]);
  expect(updates.get("governance")).toEqual([...governanceSkills, PAGE_OPERATOR_SKILL]);
  expect(updates.get("builder")).toEqual([...appBuilderSkills, PAGE_OPERATOR_SKILL]);
  expect(updates.get("ops")).toEqual([...opsSkills, PAGE_OPERATOR_SKILL]);
  expect(updates.has("analysis")).toBe(false);
  expect(query.mock.calls[5][1]).toEqual([["modeling", "admin"]]);
});

it("strips pvt references from user-built rows, adds the operator once, and leaves clean user rows unchanged", async () => {
  const cleanSkills = [skill("custom-clean")];
  query.mockResolvedValueOnce({ rows: [
    { id: "with-pvt", kind: "user-built", skills: [skill("custom"), skill("pvt-one"), skill("pvt-two")] },
    { id: "with-pvt-and-operator", kind: "user-built", skills: [skill("pvt-old"), PAGE_OPERATOR_SKILL] },
    { id: "clean", kind: "user-built", skills: cleanSkills },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migratePageOperatorSkill(client()))
    .toEqual({ presetsUpdated: 0, userAgentsUpdated: 2, analysisRowsUpdated: 0, retiredPresetsDeleted: 0 });

  const updates = new Map(query.mock.calls.slice(1).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("with-pvt")).toEqual([skill("custom"), PAGE_OPERATOR_SKILL]);
  expect(updates.get("with-pvt-and-operator")).toEqual([PAGE_OPERATOR_SKILL]);
  expect(updates.has("clean")).toBe(false);
  expect(query).toHaveBeenCalledTimes(3);
});

it("strips dead pvt references from preset and analysis rows while preserving legitimate skills", async () => {
  const governanceSkills = [skill("knowledge-governance", "ontology"), skill("pvt-panel"), skill("assistant-report")];
  const analysisSkills = [skill("ontomato-analyst-assistant", "ontology"), skill("pvt-analysis")];
  query.mockResolvedValueOnce({ rows: [
    { id: "governance", kind: "knowledge-governance", skills: governanceSkills },
    { id: "analysis", kind: "analysis", skills: analysisSkills },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migratePageOperatorSkill(client()))
    .toEqual({ presetsUpdated: 1, userAgentsUpdated: 0, analysisRowsUpdated: 1, retiredPresetsDeleted: 0 });

  const updates = new Map(query.mock.calls.slice(1).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("governance")).toEqual([
    skill("knowledge-governance", "ontology"),
    skill("assistant-report"),
    PAGE_OPERATOR_SKILL,
  ]);
  expect(updates.get("analysis")).toEqual([skill("ontomato-analyst-assistant", "ontology")]);
});

it("is idempotent when run again over migrated rows", async () => {
  const originalRows = [
    { id: "regular", kind: "regular", skills: [skill("ontomato-analyst-assistant", "ontology")] },
    { id: "with-pvt", kind: "user-built", skills: [skill("pvt-old"), skill("custom")] },
    { id: "clean", kind: "user-built", skills: [skill("custom-clean")] },
    { id: "analysis", kind: "analysis", skills: [skill("ontomato-analyst-assistant", "ontology")] },
    { id: "modeling", kind: "modeling", skills: [] },
  ];
  query.mockResolvedValueOnce({ rows: originalRows }).mockResolvedValue({ rowCount: 1 });
  const first = await migratePageOperatorSkill(client());
  expect(first).toEqual({ presetsUpdated: 1, userAgentsUpdated: 1, analysisRowsUpdated: 0, retiredPresetsDeleted: 1 });

  const updates = new Map(query.mock.calls.slice(1, 3).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  const migratedRows = originalRows
    .filter(row => row.id !== "modeling")
    .map(row => ({ ...row, skills: updates.get(row.id) ?? row.skills }));

  query.mockReset();
  query.mockResolvedValueOnce({ rows: migratedRows });
  expect(await migratePageOperatorSkill(client()))
    .toEqual({ presetsUpdated: 0, userAgentsUpdated: 0, analysisRowsUpdated: 0, retiredPresetsDeleted: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
