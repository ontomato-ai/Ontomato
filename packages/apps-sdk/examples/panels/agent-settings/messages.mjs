/*
 * The panel's own words, by locale and key (`content.messages`). Field labels, choices and reasons are their owners';
 * these are only the titles and lines the panel's HTML lays out. The public edition writes English; the enterprise
 * edition adds its languages to the same keys.
 */
export default {
  en: {
    "agents.title": "Agents",
    "agents.empty": "Choose an agent, or create a new one.",
    "agents.creating": "New agent",
    "agents.definition": "Definition",
    "agents.model": "Model",
    "agents.modelHint": "The model the agent runs on. None keeps the domain's default model.",
    "agents.skills": "Skills",
    "agents.skillsHint": "What the agent may do beyond answering.",
    "agents.executor": "Runs as",
    "agents.executorHint": "Whose permissions the agent's work uses.",
    "agents.scope": "Data scope",
    "agents.scopeHint": "The classes the agent works on. None keeps the default scope.",
  },
};
