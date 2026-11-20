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
    { name: "modelSelection", type: "ModelSelection", description: "The selected model, with a null model ID using the domain default." },
    { name: "skills", type: "RuntimeSkillRef[]", description: "The skill references selected for the agent." },
    { name: "classNames", type: "string[]", description: "The ontology class names in the agent's configured data scope." },
    { name: "enabledMcpServiceIds", type: "UUID[]", description: "The IDs of MCP services enabled for the agent." },
    { name: "executionUserId", type: "string | null", description: "The specified execution user's ID, or null to run as the initiating user." },
    { name: "sortOrder", type: "integer", description: "The position used to order the definition in agent lists." },
  ],
  rules: "Reading, creating, or maintaining definitions in the current domain requires the analysis-agent permission."
    + " The definition service exposes only skill references the reader may use, and the execution identity service validates changes to the execution user.",
} as const satisfies PlatformTypeDetailDeclaration;
