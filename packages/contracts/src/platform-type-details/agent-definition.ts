import { AGENT_DEFINITION } from "../platform-object-types";
import type { PlatformTypeDetailDeclaration } from "../platform-type-details";

export const agentDefinitionTypeDetail = {
  id: AGENT_DEFINITION,
  definition: "A reusable agent configuration that defines its instructions, model, skills, tools, data scope, and execution identity.",
  properties: [
    { name: "id", type: "UUID", description: "The stable identifier of the agent definition." },
    { name: "name", type: "string", description: "The name shown in agent lists and selectors." },
    { name: "description", type: "string", description: "A short description of what the agent is for." },
    { name: "icon", type: "string | null", description: "The agent's icon reference, when one is configured." },
    { name: "enabled", type: "boolean", description: "Whether the agent is enabled for use." },
    { name: "systemPrompt", type: "string", description: "The instructions supplied to the agent as its system prompt." },
    { name: "engine", type: "pi | codex", description: "The execution engine selected for new sessions." },
    { name: "modelSelection", type: "ModelSelection", description: "The selected model, with a null model ID using the domain default." },
    { name: "skills", type: "RuntimeSkillRef[]", description: "The skill references selected for the agent." },
    { name: "classNames", type: "string[]", description: "The ontology class names in the agent's configured data scope." },
    { name: "enabledMcpServiceIds", type: "UUID[]", description: "The IDs of MCP services enabled for the agent." },
    { name: "executionUserId", type: "string | null", description: "Default execution user ID for automated/unattended runs, or null. Interactive runs with a logged-in user inherit that user's permissions." },
    { name: "sortOrder", type: "integer", description: "The position used to order the definition in agent lists." },
  ],
  rules: "Creating an agent requires the create agent permission. Listing agents and viewing configurations require the object view grant. Editing, deleting, and managing grants require the object edit grant. Chatting with or invoking an agent requires the object use grant."
    + " Choosing skills for an existing agent requires edit permission on that agent. The execution identity service validates changes to the execution user.",
} as const satisfies PlatformTypeDetailDeclaration;
