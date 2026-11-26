import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import {
  platformObjectTypes,
  platformRelationGroups,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { createPlatformOntologyCatalogueReads } from "../catalogue-reads";

vi.mock("../../../config/application", () => ({
  config: { dataQuery: { baseUrl: "http://owner.test" } },
}));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "service-token-1" }) },
}));
vi.mock("../../assistant/definition-relations", () => ({ listAgentDefinitionNodes: vi.fn() }));
vi.mock("../../assistant/skills", () => ({ assistantSkillCatalog: vi.fn() }));
vi.mock("../../business-definitions/definitions", () => ({ listPublishedDefinitions: vi.fn() }));
vi.mock("../../product-panels/component-catalogue", () => ({ readPanelComponentCatalogue: vi.fn() }));

const assertPermissionMock = vi.fn();
const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "viewer-token-1", locale: "en" };

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

beforeEach(() => {
  vi.clearAllMocks();
  installWorkbenchIdentity({ assertPermission: assertPermissionMock } as unknown as WorkbenchIdentity);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capability graph relation kinds", () => {
  it("declares no relation kind that reads the retired product grants or a definition's provenance", () => {
    for (const { id } of platformRelationKinds) {
      expect(id).not.toMatch(/^(?:role|user)\.can-(?:use|view|edit)-product$/);
      expect(id).not.toMatch(/^role\.can-(?:execute-action|author-workflow)$/);
      expect(id).not.toMatch(/^user\.(?:created|published)-(?:action|workflow|metric-view)$/);
    }
  });

  it("reads a policy's grants from the policy side instead of the role or the person", () => {
    const ids = platformRelationKinds.map(relation => relation.id);
    expect(ids).toEqual(expect.arrayContaining([
      "permission-policy.can-enter-application",
      "permission-policy.can-execute-action",
      "permission-policy.can-use-object",
    ]));
    const usesObject = platformRelationKinds.find(relation => relation.id === "permission-policy.can-use-object");
    expect(usesObject).toMatchObject({
      from: "platform:PermissionPolicy",
      to: [
        "platform:ProductPanel",
        "platform:ProductProjection",
        "platform:SDKComponent",
        "platform:AgentDefinition",
        "platform:MetricView",
        "platform:Function",
        "platform:Workflow",
      ],
      derived: false,
      owner: "java-authorization",
      group: "authorization",
    });
  });

  it("groups every relation kind into one of the five engineering purposes", () => {
    const groups = new Set(platformRelationKinds.map(relation => relation.group));
    expect([...groups].sort()).toEqual([...platformRelationGroups].sort());
    expect(groups.size).toBe(5);
  });

  it("keeps a projection's binding off the type graph while its declaration still targets every layered type", () => {
    const reads = createPlatformOntologyCatalogueReads(owner, viewer);
    const edges = panelReadResultSchemas.panelRecordList.parse(reads.graphEdges());
    expect(edges.some(edge => edge.fields.relationKind === "projection.binds-target")).toBe(false);

    const layeredTypes = Object.entries(platformObjectTypes)
      .filter(([, declaration]) => Boolean(declaration.layer))
      .map(([id]) => id);
    const bindsTarget = platformRelationKinds.find(relation => relation.id === "projection.binds-target");
    expect(bindsTarget?.to).toEqual(layeredTypes);
    expect(bindsTarget?.typeEdges).toBe(false);

    const kindRow = panelReadResultSchemas.panelRecordList.parse(reads.relationKinds())
      .find(row => row.primaryKey === "projection.binds-target");
    expect(kindRow?.fields.typeGraphNote).toBe("A projection can bind any type.");
    expect(kindRow?.fields.group).toBe("assembly");
  });

  it("carries the group and its label on every relation kind row and type edge", () => {
    const reads = createPlatformOntologyCatalogueReads(owner, viewer);
    const kinds = panelReadResultSchemas.panelRecordList.parse(reads.relationKinds());
    for (const row of kinds) {
      expect(platformRelationGroups, row.primaryKey).toContain(row.fields.group);
      expect(String(row.fields.groupLabel), row.primaryKey).not.toHaveLength(0);
    }
    const edges = panelReadResultSchemas.panelRecordList.parse(reads.graphEdges());
    const byGroup = new Map(edges.map(edge => [edge.fields.group, edge.fields.groupLabel]));
    expect([...byGroup.keys()].sort()).toEqual([...platformRelationGroups].sort());
  });
});
