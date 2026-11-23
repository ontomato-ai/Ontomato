import { APPLICATION } from "../platform-object-types";
import type { PlatformTypeDetailDeclaration } from "../platform-type-details";

export const applicationTypeDetail = {
  id: APPLICATION,
  definition: "A published unit that makes content available through application entries.",
  properties: [
    { name: "id", type: "string", description: "The stable identifier of the application." },
    { name: "names", type: "Record<string, string>", description: "Display names keyed by language code." },
    { name: "descriptions", type: "Record<string, string>", description: "Application descriptions keyed by language code." },
    { name: "icon", type: "string", description: "The icon identifier used to display the application." },
    {
      name: "source",
      type: '"builtin" | "domain"',
      description: "Whether the application is declared by the platform or registered in a domain.",
    },
    {
      name: "canMaintain",
      type: "boolean",
      description: "Whether the current caller may edit the identity or delete this domain application.",
    },
    {
      name: "canEditEntries",
      type: "boolean",
      description: "Whether the current caller has maintenance authority to edit this domain panel application's entry table.",
    },
    {
      name: "canGrant",
      type: "boolean",
      description: "Whether the current caller may manage the application's sharing and grants under product edit authority.",
    },
    {
      name: "allowStandalone",
      type: "boolean",
      description: "Whether this application can be opened standalone without the platform sidebar and expose an external link.",
    },
    {
      name: "externalLink",
      type: "string",
      optional: true,
      description: "The standalone entry link exposed when standalone opening is enabled; omitted when disabled.",
    },
    {
      name: "entry",
      type: "ApplicationCatalogueEntry",
      description: "The application's landing path with an optional renderer and home path.",
    },
    {
      name: "panelUses",
      type: "ApplicationPanelUse[]",
      description: "Entries in their declared order, including paths, panel references, inputs, menu metadata, admission rules, and default agents.",
    },
    {
      name: "groups",
      type: "{ key: string, names: Record<string, string>, sort: number }[]",
      description: "Menu group keys, translated names, and sort order.",
    },
    {
      name: "entryAccess",
      type: "string[]",
      optional: true,
      description: "Application-level admission rules visible to the application's maintainers.",
    },
    {
      name: "framePanelId",
      type: "string",
      optional: true,
      description: "The ID of the application's configured frame panel, visible to maintainers.",
    },
    {
      name: "theme",
      type: "PanelThemeOverrides",
      optional: true,
      description: "The application's light and dark theme overrides, visible to maintainers.",
    },
    {
      name: "delivery",
      type: "ApplicationDelivery",
      optional: true,
      description: "Declared references to panels, projections, packages, agents, and skills, visible to maintainers.",
    },
  ],
  rules:
    "The platform maintains built-in applications, and Java checks domain identity, assigned paths, and permission to use referenced panels during domain registration. Java checks application and entry admission and panel use before opening an entry, requires maintenance authority for edits and deletion, and requires a product edit grant to manage access.",
} as const satisfies PlatformTypeDetailDeclaration;
