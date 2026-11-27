import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migrateOntologyQuerySkill } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const skill = (name: string, provider = "workbench"): RuntimeSkillRef => ({
  namespace: { kind: "provider", provider }, name,
});
const assistant = skill("ontomato-analyst-assistant", "ontology");
const ontologyQuery = skill("ontology-query", "ontology");
const client = () => ({ query }) as unknown as QueryableClient;
const updatePayload = (call: unknown[]) => JSON.parse((call[1] as unknown[])[1] as string) as RuntimeSkillRef[];

beforeEach(() => query.mockReset());

it("inserts ontology-query immediately after the assistant guidance wherever that guidance is installed", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "regular", kind: "regular", skills: [skill("assistant-report"), assistant, skill("ontomato-page-operator")] },
    { id: "analysis", kind: "analysis", skills: [assistant] },
    { id: "custom", kind: "user-built", skills: [skill("custom-entry"), assistant, skill("assistant-report")] },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migrateOntologyQuerySkill(client())).toEqual({ updated: 3 });
  const updates = new Map(query.mock.calls.slice(1).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("regular")).toEqual([skill("assistant-report"), assistant, ontologyQuery, skill("ontomato-page-operator")]);
  expect(updates.get("analysis")).toEqual([assistant, ontologyQuery]);
  expect(updates.get("custom")).toEqual([skill("custom-entry"), assistant, ontologyQuery, skill("assistant-report")]);
});

it("leaves rows without the assistant or already carrying ontology-query unchanged", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "governance", kind: "knowledge-governance", skills: [skill("knowledge-governance", "ontology")] },
    { id: "current", kind: "regular", skills: [assistant, ontologyQuery] },
  ] });

  expect(await migrateOntologyQuerySkill(client())).toEqual({ updated: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
