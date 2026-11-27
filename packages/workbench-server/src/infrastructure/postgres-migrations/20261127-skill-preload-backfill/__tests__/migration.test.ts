import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillSelection } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../../helpers";
import { migrateSkillPreload } from "../migration";

const query = vi.fn();
vi.mock("../../../postgres", () => ({ qualifiedTable: (name: string) => `"${name}"` }));

const analyst: RuntimeSkillSelection = {
  namespace: { kind: "provider", provider: "ontology" },
  name: "ontomato-analyst-assistant",
};
const report: RuntimeSkillSelection = {
  namespace: { kind: "provider", provider: "workbench" },
  name: "assistant-report",
};
const client = () => ({ query }) as unknown as QueryableClient;
const updatePayload = (call: unknown[]) => JSON.parse((call[1] as unknown[])[1] as string) as RuntimeSkillSelection[];

beforeEach(() => query.mockReset());

it("marks the analyst skill on Assistant and Analyst rows without adding or removing selections", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "regular", kind: "regular", skills: [analyst, report] },
    { id: "analysis", kind: "analysis", skills: [analyst] },
    { id: "missing", kind: "regular", skills: [report] },
  ] }).mockResolvedValue({ rowCount: 1 });

  expect(await migrateSkillPreload(client())).toEqual({ agentsUpdated: 2 });
  const updates = new Map(query.mock.calls.slice(1).map(call => [(call[1] as unknown[])[0], updatePayload(call)]));
  expect(updates.get("regular")).toEqual([{ ...analyst, preload: true }, report]);
  expect(updates.get("analysis")).toEqual([{ ...analyst, preload: true }]);
  expect(updates.has("missing")).toBe(false);
});

it("leaves other agents and already marked rows unchanged", async () => {
  query.mockResolvedValueOnce({ rows: [
    { id: "done", kind: "regular", skills: [{ ...analyst, preload: true }] },
    { id: "custom", kind: "custom", skills: [analyst] },
  ] });
  expect(await migrateSkillPreload(client())).toEqual({ agentsUpdated: 0 });
  expect(query).toHaveBeenCalledTimes(1);
});
