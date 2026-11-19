/*
 * The projections the agent settings panel composes, under their final IDs (design 2.1). Each binds one base component
 * to one platform type; what the type holds, how it is read and saved, and which of its fields may change is its owner's.
 * The same records serve the G1 candidate (registered alone) and the built-in panel.
 */
const type = (id) => ({ kind: "PlatformObjectType", id });
const agent = { kind: "object", objectType: "platform:AgentDefinition" };

const projection = (id, name, description, componentId, binding, inputs = {}, display = {}, graph) => ({
  id,
  input: { name, description, visibility: "domain", componentId, binding, ...(graph ? { graph } : {}), inputs, display },
});

export default [
  projection("agent-list", "Agents", "The agents of the domain, to choose one from.",
    "ObjectList", type("platform:AgentDefinition"), { value: agent }),
  projection("agent-summary", "Agent summary", "One agent as a reader recognises it: what it is for and whether it is on.",
    "ObjectSummary", type("platform:AgentDefinition"), { agent }, { fields: ["description", "enabled"] }),
  projection("agent-definition-form", "Agent definition", "One agent's definition, as the definitions service describes and saves it; a new agent when none is chosen.",
    "ObjectForm", type("platform:AgentDefinition"), { agent }, { creates: true }),
  projection("agent-model-choice", "Agent model", "The model an agent runs on, from the domain's model options; none keeps the domain default.",
    "ReferencePicker", type("platform:ModelOption")),
  projection("agent-skill-choice", "Agent skills", "The skills an agent may use, from the skill catalogue the reader may choose from.",
    "ReferencePicker", type("platform:Skill")),
  projection("agent-executor-choice", "Agent runs as", "The user an agent's work runs as; the identity service decides who may change it.",
    "ReferencePicker", type("platform:User")),
  projection("agent-data-scope", "Agent data scope", "The ontology classes an agent works on, chosen on the class and relationship graph; none keeps the default scope.",
    "ObjectGraph", type("platform:ObjectType"), {}, {},
    { edges: { binding: type("platform:Relationship"), sourcePath: "/fromclass", targetPath: "/toclass" } }),
];
