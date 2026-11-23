import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyTypeCount } from "@ontomato/contracts/platform-ontology";
import { ONTOLOGY_RELATION_KIND, platformObjectTypes, type PlatformRelationKindDeclaration } from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { readPlatformOntologyCounts } from "./query";
import {
  AGENT_DEFINITION,
  APPLICATION,
  ONTOLOGY_TYPE,
  PLATFORM_ONTOLOGY_LAYERS,
  PLATFORM_ONTOLOGY_RELATION_KINDS,
  PLATFORM_ONTOLOGY_TYPE_MAP,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  SDK_COMPONENT,
  assemblePlatformOntologySchemaTypes,
  relationTargets,
} from "./schema";

const instanceDirectories: Readonly<Partial<Record<string, { path: string; name: string }>>> = {
  [SDK_COMPONENT]: { path: "/ontology/components", name: "dirComponents" },
  [PRODUCT_PROJECTION]: { path: "/ontology/projections", name: "dirProjections" },
  [PRODUCT_PANEL]: { path: "/ontology/panels", name: "dirPanels" },
  [APPLICATION]: { path: "/ontology/applications", name: "dirApplications" },
  [AGENT_DEFINITION]: { path: "/ontology/agents", name: "dirAgents" },
};

const countTones = { ok: "success", refused: "warning", failed: "danger", unavailable: "info" } as const;

const detailKey = (typeLabelKey: string) => typeLabelKey.replace("platformOntology.types.", "platformOntology.typeDetails.");

function requireType(type: string) {
  const spec = PLATFORM_ONTOLOGY_TYPE_MAP.get(type);
  if (!spec) throw new HttpError(404, `Unknown platform ontology type: ${type}`, "OBJECT_NOT_FOUND");
  return spec;
}

async function readTypeSignatures(type: string) {
  requireType(type);
  return (await assemblePlatformOntologySchemaTypes()).find(spec => spec.id === type)!;
}

export function createPlatformOntologyCatalogueReads(owner: ProductOwner, viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, key);
  const word = (key: string) => text(`panels.platformOntology.${key}`);

  function typeRow(entry: PlatformOntologyTypeCount): PanelRecord {
    const { type, layer, status, count, reason } = entry;
    const tone = countTones[status];
    const countStatusLabel = word(`countStatus.${status}`);
    return {
      className: ONTOLOGY_TYPE,
      primaryKey: type,
      label: text(PLATFORM_ONTOLOGY_TYPE_MAP.get(type)!.labelKey),
      fields: {
        typeId: type,
        layer: text(`platformOntology.layers.${layer}`),
        layerId: layer,
        countStatus: status,
        countStatusLabel,
        countDisplay: status === "ok" ? String(count) : countStatusLabel,
        ...(status === "ok" && { count: count! }),
        ...(reason !== undefined && { countReason: reason }),
      },
      fieldLabels: {
        typeId: word("typeId"),
        layer: word("layer"),
        count: word("count"),
        countDisplay: word("count"),
        countStatusLabel: word("countStatus"),
        countReason: word("countReason"),
      },
      tones: { countStatus: tone, countStatusLabel: tone, countDisplay: tone },
    };
  }

  function typeRelationRow(
    relation: PlatformRelationKindDeclaration, direction: "outgoing" | "incoming", peer: string,
  ): PanelRecord {
    return {
      primaryKey: `${direction}:${relation.id}:${peer}`,
      label: text(relation.labelKey),
      fields: {
        direction, relationKind: relation.id, peer,
        peerLabel: text(platformObjectTypes[peer].labelKey!),
        derived: relation.derived,
      },
    };
  }

  return {
    async list(): Promise<PanelRecord[]> {
      const { counts } = await readPlatformOntologyCounts(owner, viewer);
      return PLATFORM_ONTOLOGY_LAYERS.flatMap(layer =>
        counts
          .filter(entry => entry.layer === layer)
          .sort((left, right) => PLATFORM_ONTOLOGY_TYPE_MAP.get(left.type)!.labelKey
            .localeCompare(PLATFORM_ONTOLOGY_TYPE_MAP.get(right.type)!.labelKey))
          .map(typeRow),
      );
    },

    async record(type: string): Promise<PanelRecord> {
      const spec = requireType(type);
      const { counts: [count] } = await readPlatformOntologyCounts(owner, viewer, [spec]);
      const row = typeRow(count);
      const detail = detailKey(spec.labelKey);
      const hasDetails = Boolean(platformTypeDetails[type]);
      const directory = instanceDirectories[type];
      const outputs = directory && { directoryPath: directory.path, directoryName: word(directory.name) };
      return {
        ...row,
        fields: {
          ...row.fields,
          definition: hasDetails ? text(`${detail}.definition`) : word("noDefinition"),
          rules: hasDetails ? text(`${detail}.rules`) : word("noRules"),
          ...outputs,
        },
        fieldLabels: {
          ...row.fieldLabels,
          definition: word("definition"),
          rules: word("rules"),
          directoryPath: word("directoryPath"),
        },
        ...(outputs && { outputs }),
      };
    },

    properties(type: string): PanelRecord[] {
      const spec = requireType(type);
      const detail = detailKey(spec.labelKey);
      return (platformTypeDetails[type]?.properties ?? []).map(property => ({
        primaryKey: property.name,
        label: property.name,
        fields: {
          name: property.name,
          type: property.type,
          optional: property.optional ?? false,
          description: text(`${detail}.properties.${property.name}`),
        },
      }));
    },

    typeRelations(type: string): PanelRecord[] {
      requireType(type);
      const outgoing = PLATFORM_ONTOLOGY_RELATION_KINDS
        .filter(relation => relation.from === type)
        .flatMap(relation => relationTargets(relation).map(peer => typeRelationRow(relation, "outgoing", peer)));
      const incoming = PLATFORM_ONTOLOGY_RELATION_KINDS
        .filter(relation => relationTargets(relation).includes(type))
        .map(relation => typeRelationRow(relation, "incoming", relation.from));
      return [...outgoing, ...incoming];
    },

    async reads(type: string): Promise<PanelRecord[]> {
      const spec = await readTypeSignatures(type);
      return Object.entries(spec.reads ?? {}).map(([name, read]) => ({
        primaryKey: name,
        label: name,
        fields: {
          name,
          parameters: read.parameterMode === "fixed" ? Object.keys(read.params) : [read.parameter],
          result: read.result,
          source: read.source,
        },
      }));
    },

    async operations(type: string): Promise<PanelRecord[]> {
      const spec = await readTypeSignatures(type);
      return (spec.operations ?? []).map(({ id, kind, effect, inputSchema, batch }) => ({
        primaryKey: id,
        label: id,
        fields: { id, kind, effect, inputs: Object.keys(inputSchema.properties ?? inputSchema), batch: Boolean(batch) },
      }));
    },

    relationKinds(): PanelRecord[] {
      return PLATFORM_ONTOLOGY_RELATION_KINDS.map(relation => ({
        className: ONTOLOGY_RELATION_KIND,
        primaryKey: relation.id,
        label: text(relation.labelKey),
        fields: {
          id: relation.id, from: relation.from, to: relation.to, derived: relation.derived, owner: relation.owner,
        },
      }));
    },
  };
}
