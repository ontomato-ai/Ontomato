/*
 * The agent settings panel's declaration (design 2.1): the state one instance keeps and the projections it composes.
 * The candidate's `panel.json` and the registered panel record carry exactly this; `material.mjs` writes both from it.
 *
 * `selectedAgent` is the agent shown; `mode` says whether the instance is choosing one (`list`), creating one (`create`)
 * or editing the selected one (`edit`). Both may travel in the address. The form's values, its unsaved state and its
 * errors never do: the form slot holds them, and the model, skill, executor and data scope slots edit that same form
 * through their field ports.
 */
export default {
  state: {
    selectedAgent: { kind: "object", objectType: "platform:AgentDefinition", deepLink: true },
    mode: { kind: "scalar", type: "string", deepLink: true },
  },
  slots: {
    agents: { projectionId: "agent-list", inputs: { value: { state: "selectedAgent" } } },
    summary: { projectionId: "agent-summary", inputs: { agent: { state: "selectedAgent" } } },
    definition: { projectionId: "agent-definition-form", inputs: { agent: { state: "selectedAgent" } } },
    model: { projectionId: "agent-model-choice", inputs: {}, formField: { slot: "definition", path: "/modelSelection/modelId" } },
    skills: { projectionId: "agent-skill-choice", inputs: {}, formField: { slot: "definition", path: "/skills" } },
    executor: { projectionId: "agent-executor-choice", inputs: {}, formField: { slot: "definition", path: "/executionUserId" } },
    scope: { projectionId: "agent-data-scope", inputs: {}, formField: { slot: "definition", path: "/classNames" } },
  },
  // Creating an agent is a change of this instance's own state; the form's owner then supplies the new agent's defaults.
  operations: [{ id: "newAgent", labelKey: "agents.creating", kind: "state", sets: { selectedAgent: null, mode: "create" } }],
};
