import {
  panelRecordFieldText,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyTypeCount } from "@ontomato/contracts/platform-ontology";
import { ONTOLOGY_RELATION_KIND, type PlatformRelationKindDeclaration } from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { countStatusNames, layerNames, localized, relationNames, typeDetailsZh, typeNames } from "./catalogue-text";
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

const instanceDirectories: Readonly<Partial<Record<string, NonNullable<PanelRecord["outputs"]>>>> = {
  [SDK_COMPONENT]: { directoryPath: "/ontology/components", directoryNameKey: "cm.dirComponents" },
  [PRODUCT_PROJECTION]: { directoryPath: "/ontology/projections", directoryNameKey: "cm.dirProjections" },
  [PRODUCT_PANEL]: { directoryPath: "/ontology/panels", directoryNameKey: "cm.dirPanels" },
  [APPLICATION]: { directoryPath: "/ontology/applications", directoryNameKey: "cm.dirApplications" },
  [AGENT_DEFINITION]: { directoryPath: "/ontology/agents", directoryNameKey: "cm.dirAgents" },
};

const countTones = { ok: "success", refused: "warning", failed: "danger", unavailable: "info" } as const;

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
  const text = (value: PanelRecord["fields"][string]) => panelRecordFieldText(value, viewer.locale, "en");
  const typeLabel = (type: string) => text(typeNames[type] ?? type);
  const relationLabel = (relation: PlatformRelationKindDeclaration) => text(relationNames[relation.id] ?? relation.id);

  function typeRow(entry: PlatformOntologyTypeCount): PanelRecord {
    const { type, layer, status, count, reason } = entry;
    const tone = countTones[status];
    return {
      className: ONTOLOGY_TYPE,
      primaryKey: type,
      label: typeLabel(type),
      fields: {
        typeId: type,
        layer: layerNames[layer],
        layerId: layer,
        countStatus: status,
        countStatusLabel: countStatusNames[status],
        ...(count !== undefined && { count }),
        ...(reason !== undefined && { countReason: reason }),
      },
      fieldLabels: {
        typeId: text(localized("Type ID", "类型 ID")),
        layer: text(localized("Layer", "层级")),
        count: text(localized("Readable instances", "可读实例数")),
        countStatusLabel: text(localized("Count status", "计数状态")),
        countReason: text(localized("Reason", "原因")),
      },
      tones: { countStatus: tone, countStatusLabel: tone },
    };
  }

  function typeRelationRow(
    relation: PlatformRelationKindDeclaration, direction: "outgoing" | "incoming", peer: string,
  ): PanelRecord {
    return {
      primaryKey: `${direction}:${relation.id}:${peer}`,
      label: relationLabel(relation),
      fields: {
        direction, relationKind: relation.id, peer, peerLabel: typeNames[peer] ?? peer, derived: relation.derived,
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
      const detail = platformTypeDetails[type];
      const zh = typeDetailsZh[type];
      const outputs = instanceDirectories[type];
      return {
        ...row,
        fields: {
          ...row.fields,
          ...(detail && {
            definition: zh ? localized(detail.definition, zh.definition) : detail.definition,
            rules: zh ? localized(detail.rules, zh.rules) : detail.rules,
          }),
          ...outputs,
        },
        fieldLabels: {
          ...row.fieldLabels,
          definition: text(localized("Definition", "定义")),
          rules: text(localized("Creation and use rules", "创建与使用规则")),
          directoryPath: text(localized("Instance directory", "实例目录")),
        },
        ...(outputs && { outputs }),
      };
    },

    properties(type: string): PanelRecord[] {
      requireType(type);
      const translations = typeDetailsZh[type]?.properties;
      return (platformTypeDetails[type]?.properties ?? []).map(property => {
        const zh = translations?.[property.name];
        return {
          primaryKey: property.name,
          label: property.name,
          fields: {
            name: property.name,
            type: property.type,
            optional: property.optional ?? false,
            description: zh ? localized(property.description, zh) : property.description,
          },
        };
      });
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
        label: relationLabel(relation),
        fields: {
          id: relation.id, from: relation.from, to: relation.to, derived: relation.derived, owner: relation.owner,
        },
      }));
    },
  };
}
