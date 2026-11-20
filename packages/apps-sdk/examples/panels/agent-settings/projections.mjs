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
const json = { kind: "json" };
const text = { kind: "scalar", type: "string" };
const read = (source, name, params = {}) => ({ source, read: name, params });
const formParams = { values: { input: "values" }, changedField: { input: "changedField" } };

const projection = (id, name, description, component, ports) => ({
  id,
  input: {
    name, description, visibility: "domain", componentId: `@ontomato/sdk:${component}`,
    inputs: {}, outputs: {}, config: {}, ...ports,
  },
});

/** A catalogue to choose a form field's value from, and the values the form holds, listed as choices. */
const picker = (objectType, search = false) => ({
  inputs: { values: json, ...(search ? { keyword: text, page: json } : {}) },
  data: {
    options: read(type(objectType), "options", search ? { keyword: { input: "keyword" }, page: { input: "page" } } : {}),
    selected: read(type(objectType), "resolve", { values: { input: "values" } }),
  },
});

export default [
  projection("agent-list", "Agents", "The agents of the domain, to choose one from.", "ObjectList", {
    inputs: { value: agent },
    outputs: { selected: agent },
    data: { rows: read(type(AGENT_DEFINITION), "list") },
  }),
  projection("agent-summary", "Agent summary", "One agent as a reader recognises it: what it is for and whether it is on.", "ObjectSummary", {
    inputs: { agent },
    config: { fields: ["description", "enabled"] },
    data: { record: read(shownAgent, "record") },
  }),
  projection("agent-definition-form", "Agent definition", "One agent's definition, as the definitions service describes and saves it; a new agent when none is chosen.", "ObjectForm", {
    inputs: { agent, values: json, changedField: text },
    config: { creates: true },
    data: {
      form: read(shownAgent, "form", formParams),
      createForm: read(type(AGENT_DEFINITION), "createForm", formParams),
    },
  }),
  projection("agent-model-choice", "Agent model", "The model an agent runs on, from the domain's model options; none keeps the domain default.",
    "ReferencePicker", picker("platform:ModelOption")),
  projection("agent-skill-choice", "Agent skills", "The skills an agent may use, from the skill catalogue the reader may choose from.",
    "ReferencePicker", picker("platform:Skill")),
  projection("agent-executor-choice", "Agent runs as", "The user an agent's work runs as; the identity service decides who may change it.",
    "ReferencePicker", picker("platform:User", true)),
  projection("agent-data-scope", "Agent data scope", "The ontology classes an agent works on, chosen on the class and relationship graph; none keeps the default scope.", "ObjectGraph", {
    config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
    data: {
      nodes: read(type("platform:ObjectType"), "list"),
      edges: read(type("platform:Relationship"), "list"),
    },
  }),
];
