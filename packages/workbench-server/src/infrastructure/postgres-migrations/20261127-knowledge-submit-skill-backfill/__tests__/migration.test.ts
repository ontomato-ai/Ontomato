import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migrateKnowledgeSubmitSkill } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const skill = (name: string, provider = "workbench"): RuntimeSkillRef => ({
  namespace: { kind: "provider", provider }, name,
});
const assistant = skill("ontomato-analyst-assistant", "ontology");
const ontologyQuery = skill("ontology-query", "ontology");
const knowledgeSubmit = skill("knowledge-submit", "ontology");
const client = () => ({ query }) as unknown as QueryableClient;
const updatePayload = (call: unknown[]) => JSON.parse((call[1] as unknown[])[1] as string) as RuntimeSkillRef[];

beforeEach(() => query.mockReset());

it("inserts knowledge-submit after ontology-query wherever the assistant guidance is installed", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "regular", kind: "regular", skills: [assistant, ontologyQuery, skill("ontomato-page-operator")] },
    { id: "analysis", kind: "analysis", skills: [assistant, ontologyQuery] },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migrateKnowledgeSubmitSkill(client())).toEqual({ updated: 2 });
  const updates = new Map(query.mock.calls.slice(1).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("regular")).toEqual([assistant, ontologyQuery, knowledgeSubmit, skill("ontomato-page-operator")]);
  expect(updates.get("analysis")).toEqual([assistant, ontologyQuery, knowledgeSubmit]);
});

it("leaves rows without the assistant or already carrying knowledge-submit unchanged", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "governance", kind: "knowledge-governance", skills: [skill("knowledge-governance", "ontology")] },
    { id: "current", kind: "regular", skills: [assistant, ontologyQuery, knowledgeSubmit] },
  ] });

  expect(await migrateKnowledgeSubmitSkill(client())).toEqual({ updated: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
