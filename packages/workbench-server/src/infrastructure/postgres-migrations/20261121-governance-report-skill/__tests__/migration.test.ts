import { beforeEach, expect, it, vi } from "vitest";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migrateGovernanceReportSkill } from "../migration";

const GOVERNANCE_SKILL = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "knowledge-governance" };
const GOVERNANCE_REPORT_SKILL = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "assistant-report" };

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

beforeEach(() => query.mockReset());

it("adds assistant-report to existing knowledge-governance agents without duplicating it", async () => {
  const custom = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "custom" };
  query.mockResolvedValueOnce({
    rows: [
      { id: "needs-report", skills: [GOVERNANCE_SKILL] },
      { id: "with-custom", skills: [GOVERNANCE_SKILL, custom] },
      { id: "already-has-report", skills: [GOVERNANCE_SKILL, GOVERNANCE_REPORT_SKILL] },
    ],
  }).mockResolvedValue({ rowCount: 1 });

  expect(await migrateGovernanceReportSkill({ query } as unknown as QueryableClient)).toEqual({ agents: 2 });
  expect(query).toHaveBeenCalledTimes(3);

  const firstUpdate = JSON.parse(query.mock.calls[1][1][1]);
  expect(firstUpdate.map(runtimeSkillKey)).toEqual([runtimeSkillKey(GOVERNANCE_SKILL), runtimeSkillKey(GOVERNANCE_REPORT_SKILL)]);

  const secondUpdate = JSON.parse(query.mock.calls[2][1][1]);
  expect(secondUpdate.map(runtimeSkillKey)).toEqual([
    runtimeSkillKey(GOVERNANCE_SKILL),
    runtimeSkillKey(custom),
    runtimeSkillKey(GOVERNANCE_REPORT_SKILL),
  ]);
});

it("leaves already migrated rows untouched", async () => {
  query.mockResolvedValueOnce({
    rows: [{ id: "already", skills: [GOVERNANCE_SKILL, GOVERNANCE_REPORT_SKILL] }],
  });

  expect(await migrateGovernanceReportSkill({ query } as unknown as QueryableClient)).toEqual({ agents: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
