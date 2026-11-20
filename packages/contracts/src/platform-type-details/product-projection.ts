import { PRODUCT_PROJECTION } from "../platform-object-types";
import type { PlatformTypeDetailDeclaration } from "../platform-type-details";

export const productProjectionTypeDetail = {
  id: PRODUCT_PROJECTION,
  definition: "A record that binds an SDK component to ontology data and to operations it can initiate.",
  properties: [
    { name: "id", type: "string", description: "The stable identifier of the projection." },
    { name: "name", type: "string", description: "The name shown in projection lists and selectors." },
    { name: "description", type: "string", description: "A short description of the projection's purpose." },
    { name: "componentId", type: "string", description: "The package-qualified ID of the SDK component used by the projection." },
    {
      name: "data", type: "Record<string, DirectProjectionData>",
      description: "Named data reads, each with its source, read method, and declared parameter bindings.",
    },
    {
      name: "operations", type: "Record<string, ProjectionOperationBinding>", optional: true,
      description: "Named operations the projection binds explicitly, with their owner operation and any declared target.",
    },
    { name: "config", type: "RuntimeJsonObject", description: "The configuration values supplied to the SDK component." },
    { name: "inputs", type: 'DirectProjectionPorts["inputs"]', description: "The types of named values supplied by a placement." },
    { name: "outputs", type: "Record<string, DirectPanelPortType>", description: "The types of named values the projection exposes to its host." },
    {
      name: "conversationEntry", type: "PanelConversationEntry", optional: true,
      description: "The declared conversation entry for opening a composer from this projection.",
    },
    {
      name: "metricId", type: "string", optional: true,
      description: "The ID of the registered MetricView on a source-card chart projection.",
    },
    { name: "visibility", type: '"private" | "domain"', description: "The initial sharing scope recorded for the projection." },
    { name: "domainId", type: "string", description: "The ID of the domain that owns the record." },
    { name: "ownerId", type: "string", description: "The ID of the projection's registered owner." },
    { name: "revision", type: "integer", description: "The current revision used to check for concurrent edits at save time." },
    { name: "createdAt", type: "string", description: "The creation time in ISO 8601 format." },
    { name: "updatedAt", type: "string", description: "The most recent update time in ISO 8601 format." },
    { name: "editable", type: "boolean", description: "Whether the current reader has the edit Grant for this projection." },
  ],
  rules: "Domain registrants create projections. A projection's use Grant governs use and its edit Grant governs editing, sharing, and deletion; the data or operation owner authorizes the underlying business reads and writes.",
} as const satisfies PlatformTypeDetailDeclaration;
