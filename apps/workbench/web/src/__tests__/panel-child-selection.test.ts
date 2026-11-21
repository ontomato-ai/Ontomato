import { expect, it } from "vitest";
import { watch } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { ACTION, SKILL } from "@ontomato/contracts/platform-object-types";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { noOperations } from "./panel-frame";

it("clears child selection atomically when switching parent and carries child-object selection in pageContext", () => {
  const manifest = definePanel({
    state: {
      selectedSkill: { type: { kind: "object", objectType: SKILL }, deepLink: true },
      selectedFile: {
        type: { kind: "child-object", parentType: SKILL, collection: "files" },
        deepLink: true,
      },
    },
    members: {},
    events: {},
  });
  const skill = (primaryKey: string) => ({ className: SKILL, primaryKey });
  const file = {
    parent: { objectType: SKILL, primaryKey: "skill-1" },
    primaryKey: "opaque-s1-f2",
  };
  const instance = createPanelInstance(manifest, {
    ...noOperations,
    text: (key) => key,
    translate: () => "Skill",
    pageKey: "skill-test",
    url: () => "/applications/app-test/skills",
    label: () => "Skills",
    initial: { selectedSkill: skill("skill-1"), selectedFile: file },
    recordDraftCreated: async () => {},
    readProjection: async () => { throw new Error("The instance declares no projection"); },
  });
  instance.nameObjects(SKILL, [{ primaryKey: "skill-1", label: "Skill 1" }]);
  instance.nameChildObjects(file.parent, "files", [{ primaryKey: file.primaryKey, label: "SKILL.md" }]);

  expect(instance.state.values.value.selectedFile).toEqual(file);
  expect(instance.pageContext.value.selection).toEqual([
    { kind: SKILL, id: "skill-1", label: `Skill 1 (${SKILL} skill-1)` },
    { kind: "child-object", parent: file.parent, collection: "files", id: file.primaryKey, label: "Skill Skill 1 / SKILL.md (opaque-s1-f2)" },
  ]);

  const states: unknown[] = [];
  const selections: unknown[] = [];
  const stopState = watch(instance.state.values, (state) => states.push(state), { flush: "sync" });
  const stopSelection = watch(() => instance.pageContext.value.selection, (selection) => selections.push(selection), { flush: "sync" });
  try {
    instance.state.setState({ selectedSkill: skill("skill-2"), selectedFile: null });
    expect(states).toEqual([{ selectedSkill: skill("skill-2"), selectedFile: null }]);
    expect(selections).toEqual([[expect.objectContaining({ kind: SKILL, id: "skill-2" })]]);

    expect(() => instance.state.setState({
      selectedSkill: skill("skill-1"),
      selectedFile: skill("not-a-child-identity"),
    })).toThrow(TypeError);
    expect(() => instance.state.setState({
      selectedSkill: skill("skill-1"),
      selectedFile: { parent: { objectType: ACTION, primaryKey: "action-1" }, primaryKey: "wrong-parent-type" },
    })).toThrow(TypeError);
    expect(instance.state.values.value).toEqual({ selectedSkill: skill("skill-2"), selectedFile: null });
  } finally {
    stopState();
    stopSelection();
  }
});
