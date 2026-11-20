/*
 * The projections the agent settings panel composes, under their final IDs (design 2.1). Each is one SDK component and
 * the data it shows, every datum a read its owner registered: the definitions service's agents, record and forms, the
 * model, skill and user catalogues, and the ontology's classes and relationships. What a type holds, how it is read and
 * saved, and which of its fields may change is its owner's. The same records serve the G1 candidate and the built-in
 * panel.
 */
const AGENT_DEFINITION = "platform:AgentDefinition";
const type = (id) => ({ type: { kind: "PlatformObjectType", id } });
const shownAgent = { object: { input: "agent" } };
const agent = { kind: "object", objectType: AGENT_DEFINITION };
const read = (source, name) => ({ source, read: name, params: {} });

const projection = (id, name, description, component, ports) => ({
  id,
  input: {
    name, description, visibility: "domain", componentId: `@ontomato/sdk:${component}`,
    inputs: {}, outputs: {}, config: {}, ...ports,
  },
});

/**
 * A catalogue to choose a form field's value from, and the values the form holds, listed as choices. The picker gives
 * the reader's words, the page and the held values itself.
 */
const picker = (objectType) => ({
  data: {
    options: read(type(objectType), "options"),
    selected: read(type(objectType), "resolve"),
  },
});

export default [
  projection("agent-list", "Agents", "The agents of the domain, to choose one from.", "ObjectList", {
    outputs: { selected: agent },
    data: { rows: read(type(AGENT_DEFINITION), "list") },
  }),
  projection("agent-summary", "Agent summary", "One agent as a reader recognises it: what it is for and whether it is on.", "ObjectSummary", {
    inputs: { agent },
    config: { fields: ["description", "enabled"] },
    data: { record: read(shownAgent, "record") },
  }),
  projection("agent-definition-form", "Agent definition", "One agent's definition, as the definitions service describes and saves it; a new agent when none is chosen.", "ObjectForm", {
    // With no agent chosen the form is the owner's create form; the form gives its values and changed field itself.
    inputs: { agent },
    data: {
      form: read(shownAgent, "form"),
      createForm: read(type(AGENT_DEFINITION), "createForm"),
    },
    // The definitions service's own save: the chosen agent's, or a new one's while none is chosen.
    operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
  }),
  projection("agent-model-choice", "Agent model", "The model an agent runs on, from the domain's model options; none keeps the domain default.",
    "ReferencePicker", picker("platform:ModelOption")),
  projection("agent-skill-choice", "Agent skills", "The skills an agent may use, from the skill catalogue the reader may choose from.",
    "ReferencePicker", picker("platform:Skill")),
  projection("agent-executor-choice", "Agent runs as", "The user an agent's work runs as; the identity service decides who may change it.",
    "ReferencePicker", picker("platform:User")),
  projection("agent-data-scope", "Agent data scope", "The ontology classes an agent works on, chosen on the class and relationship graph; none keeps the default scope.", "ObjectGraph", {
    config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
    data: {
      nodes: read(type("platform:ObjectType"), "list"),
      edges: read(type("platform:Relationship"), "list"),
    },
  }),
];
