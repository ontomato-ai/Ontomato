import { expect, it } from "vitest";
import { watch } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { KNOWLEDGE_GOVERNANCE_RECORD, SKILL } from "@ontomato/contracts/platform-object-types";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { noOperations } from "./panel-frame";

it("clears child selection atomically when switching parent and carries child-object selection in pageContext", () => {
  const manifest = definePanel({
    state: {
      selectedRecord: { type: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD }, deepLink: true },
      selectedIssue: {
        type: { kind: "child-object", parentType: KNOWLEDGE_GOVERNANCE_RECORD, collection: "issues" },
        deepLink: true,
      },
    },
    members: {},
    events: {},
  });
  const record = (primaryKey: string) => ({ className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey });
  const issue = {
    parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
    primaryKey: "opaque-r1-i2",
  };
  const instance = createPanelInstance(manifest, {
    ...noOperations,
    text: (key) => key,
    pageKey: "governance-test",
    url: () => "/applications/app-test/governance",
    label: () => "Governance report",
    initial: { selectedRecord: record("rec-1"), selectedIssue: issue },
    recordDraftCreated: async () => {},
    readProjection: async () => { throw new Error("The instance declares no projection"); },
  });
  instance.nameObjects(KNOWLEDGE_GOVERNANCE_RECORD, [{ primaryKey: "rec-1", label: "Record 1" }]);
  instance.nameChildObjects(issue.parent, "issues", [{ primaryKey: issue.primaryKey, label: "Issue 1B" }]);

  expect(instance.state.values.value.selectedIssue).toEqual(issue);
  expect(instance.pageContext.value.selection).toEqual([
    { kind: KNOWLEDGE_GOVERNANCE_RECORD, id: "rec-1", label: `Record 1 (${KNOWLEDGE_GOVERNANCE_RECORD} rec-1)` },
    { kind: "child-object", parent: issue.parent, collection: "issues", id: issue.primaryKey, label: "Record 1 / Issue 1B (opaque-r1-i2)" },
  ]);

  const states: unknown[] = [];
  const selections: unknown[] = [];
  const stopState = watch(instance.state.values, (state) => states.push(state), { flush: "sync" });
  const stopSelection = watch(() => instance.pageContext.value.selection, (selection) => selections.push(selection), { flush: "sync" });
  try {
    instance.state.setState({ selectedRecord: record("rec-2"), selectedIssue: null });
    expect(states).toEqual([{ selectedRecord: record("rec-2"), selectedIssue: null }]);
    expect(selections).toEqual([[expect.objectContaining({ kind: KNOWLEDGE_GOVERNANCE_RECORD, id: "rec-2" })]]);

    expect(() => instance.state.setState({
      selectedRecord: record("rec-1"),
      selectedIssue: record("not-a-child-identity"),
    })).toThrow(TypeError);
    expect(() => instance.state.setState({
      selectedRecord: record("rec-1"),
      selectedIssue: { parent: { objectType: SKILL, primaryKey: "skill-1" }, primaryKey: "wrong-parent-type" },
    })).toThrow(TypeError);
    expect(instance.state.values.value).toEqual({ selectedRecord: record("rec-2"), selectedIssue: null });
  } finally {
    stopState();
    stopSelection();
  }
});
