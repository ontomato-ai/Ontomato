import { agentDefinitionAdapters } from "../panel/agent-definition";
import { mcpServiceOptionAdapters } from "../panel/mcp-service-option";
import { modelOptionAdapters } from "../panel/model-option";
import { ontologyMetadataAdapters } from "../panel/ontology-metadata";
import { skillAdapters } from "../panel/skill";
import { userAdapters } from "../panel/user";
import type { PlatformObjectAdapterFactory } from "../panel/platform-objects";

/** Resource adapters use the frame's request path and the requests declared for their bindings. */
export const platformObjectAdapters: readonly PlatformObjectAdapterFactory[] = [
  agentDefinitionAdapters,
  skillAdapters,
  modelOptionAdapters,
  mcpServiceOptionAdapters,
  userAdapters,
  ontologyMetadataAdapters,
];
