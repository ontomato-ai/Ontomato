import { PRODUCT_PANEL } from "../platform-object-types";
import type { PlatformTypeDetailDeclaration } from "../platform-type-details";

export const productPanelTypeDetail = {
  id: PRODUCT_PANEL,
  definition: "A reusable unit of content composed of Vue page code and a panel declaration.",
  properties: [
    { name: "id", type: "string", description: "The stable identifier of the panel." },
    { name: "name", type: "string", description: "The name shown in panel lists and selectors." },
    { name: "description", type: "string", description: "A short description of the panel's purpose." },
    {
      name: "content", type: "ProductPanelContent",
      description: "The HTML template and Vue module, with optional styles, usage notes, and localized messages.",
    },
    {
      name: "manifest", type: "PanelManifest",
      description: "The declaration of state fields, member references and their connections, and event wiring.",
    },
    { name: "theme", type: "PanelThemeOverrides", optional: true, description: "The panel's light and dark theme overrides." },
    { name: "template", type: "boolean", optional: true, description: "Whether this panel is designated for reuse as a template." },
    { name: "visibility", type: '"private" | "domain"', description: "The initial sharing scope recorded for the panel." },
    { name: "domainId", type: "string", description: "The ID of the domain that owns the record." },
    { name: "ownerId", type: "string", description: "The ID of the panel's registered owner." },
    { name: "revision", type: "integer", description: "The current revision used to check for concurrent edits at save time." },
    { name: "createdAt", type: "string", description: "The creation time in ISO 8601 format." },
    { name: "updatedAt", type: "string", description: "The most recent update time in ISO 8601 format." },
    { name: "editable", type: "boolean", description: "Whether the current reader has the edit Grant for this panel." },
  ],
  rules: "Domain registrants create panels. A panel's use Grant governs use and its edit Grant governs editing, sharing, and deletion; the data or operation owner authorizes the underlying business reads and writes.",
} as const satisfies PlatformTypeDetailDeclaration;
