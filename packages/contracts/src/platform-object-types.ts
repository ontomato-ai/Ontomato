export const SCHEDULED_TASK = "platform:ScheduledTask";
export const AGENT_DEFINITION = "platform:AgentDefinition";
export const SKILL = "platform:Skill";
export const MODEL_OPTION = "platform:ModelOption";
export const MCP_SERVICE_OPTION = "platform:McpServiceOption";
export const USER = "platform:User";
export const OBJECT_TYPE = "platform:ObjectType";
export const ATTRIBUTE = "platform:Attribute";
export const RELATIONSHIP = "platform:Relationship";
export const METRIC_VIEW = "platform:MetricView";
export const FUNCTION = "platform:Function";

export interface PlatformObjectTypeDeclaration {
  /** Set for types that have a declared place in the four-layer ontology. */
  layer?: "fact" | "capability" | "governance" | "product";
}

/** Type-level metadata shared by projection bindings and ontology catalogues. */
export const platformObjectTypes: Readonly<Record<string, PlatformObjectTypeDeclaration>> = {
  [SCHEDULED_TASK]: {},
  [AGENT_DEFINITION]: { layer: "product" },
  [SKILL]: { layer: "capability" },
  [MODEL_OPTION]: {},
  [MCP_SERVICE_OPTION]: {},
  [USER]: { layer: "governance" },
  [OBJECT_TYPE]: { layer: "fact" },
  [ATTRIBUTE]: { layer: "fact" },
  [RELATIONSHIP]: { layer: "fact" },
  [METRIC_VIEW]: { layer: "capability" },
  [FUNCTION]: { layer: "capability" },
};
