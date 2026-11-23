/*
 * The agent settings panel's declaration (design 2.1): the state one instance keeps, the projections it places as
 * members, and its header commands. The candidate's `panel.json` and the registered panel record carry exactly this;
 * `material.mjs` writes both from it.
 *
 * `selectedAgent` is the agent shown; `mode` says whether the instance is choosing one (`list`), creating one (`create`)
 * or editing the selected one (`edit`). Both may travel in the address. The form's values, its unsaved state and its
 * errors never do: the `definition` member holds them, and the model, skill, executor and data scope members edit that
 * same form through their field ports.
 */
const agent = { kind: "object", objectType: "platform:AgentDefinition" };
const shown = { agent: { state: "selectedAgent" } };
const field = (path) => ({ slot: "definition", path });

export default {
  state: {
    selectedAgent: { type: agent, deepLink: true },
    mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
  },
  members: {
    agents: { target: { projectionId: "agent-list" }, outputs: { selected: { state: "selectedAgent" } } },
    summary: { target: { projectionId: "agent-summary" }, inputs: shown },
    definition: { target: { projectionId: "agent-definition-form" }, inputs: shown },
    model: { target: { projectionId: "agent-model-choice" }, formField: field("/modelSelection/modelId") },
    skills: { target: { projectionId: "agent-skill-choice" }, formField: field("/skills") },
    executor: { target: { projectionId: "agent-executor-choice" }, formField: field("/executionUserId") },
    scope: { target: { projectionId: "agent-data-scope" }, formField: field("/classNames") },
  },
};
