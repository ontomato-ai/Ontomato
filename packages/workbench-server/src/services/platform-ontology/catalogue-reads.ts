import type { PanelRecord, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyType, PlatformOntologyTypeCount } from "@ontomato/contracts/platform-ontology";
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
  ORG_GRANT,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PLATFORM_ONTOLOGY_LAYERS,
  PLATFORM_ONTOLOGY_RELATION_KINDS,
  PLATFORM_ONTOLOGY_TYPES,
  PLATFORM_ONTOLOGY_TYPE_MAP,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  SDK_COMPONENT,
  assemblePlatformOntologySchemaTypes,
  relationTargets,
} from "./schema";

const instanceDirectories: Readonly<Partial<Record<string, { path: string; name: string }>>> = {
  [ORG_UNIT]: { path: "/permissions/organization", name: "dirOrganization" },
  [ORG_POSITION]: { path: "/permissions/organization", name: "dirOrganization" },
  [PERMISSION_POLICY]: { path: "/permissions/policies", name: "dirPolicies" },
  [ORG_GRANT]: { path: "/permissions/organization", name: "dirOrganization" },
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

export interface RelationKindDisplay {
  readonly label: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly endpoints: string;
}

/**
 * Resolves owner-authoritative distinguishable labels and endpoint metadata for every declared relation kind.
 * When a locale pack maps multiple relation kinds to the same text, prepends the source type label so filter items,
 * graph edges, and relation panels remain unambiguous in every locale.
 */
export function createRelationKindDisplayMap(locale: string | undefined): ReadonlyMap<string, RelationKindDisplay> {
  const text = (key: string) => tForLocale(locale, key);
  const typeLabel = (typeId: string) => text(platformObjectTypes[typeId]?.labelKey ?? typeId);
  const baseLabels = PLATFORM_ONTOLOGY_RELATION_KINDS.map((relation) => text(relation.labelKey));
  const counts = new Map<string, number>();
  for (const label of baseLabels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const display = new Map<string, RelationKindDisplay>();
  PLATFORM_ONTOLOGY_RELATION_KINDS.forEach((relation, index) => {
    const baseLabel = baseLabels[index]!;
    const fromLabel = typeLabel(relation.from);
    const targetLabels = relationTargets(relation).map(typeLabel);
    const toLabel = targetLabels.length <= 3
      ? targetLabels.join(" / ")
      : `${targetLabels.slice(0, 2).join(" / ")} +${targetLabels.length - 2}`;
    const label = (counts.get(baseLabel) ?? 0) > 1 ? `${fromLabel} · ${baseLabel}` : baseLabel;
    display.set(relation.id, {
      label,
      fromLabel,
      toLabel,
      endpoints: `${fromLabel} → ${toLabel}`,
    });
  });
  return display;
}

export function createPlatformOntologyCatalogueReads(owner: ProductOwner, viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, key);
  const word = (key: string) => text(`panels.platformOntology.${key}`);
  const relationDisplay = createRelationKindDisplayMap(viewer.locale);
  const typeLabel = (id: string) => text(platformObjectTypes[id].labelKey!);
  const typeRef = (id: string) => ({
    kind: "reference" as const, className: ONTOLOGY_TYPE, primaryKey: id, label: typeLabel(id),
  });
  const endpointLabels = {
    fromLabel: word("fromObject"),
    toLabel: word("toObject"),
    derived: word("derived"),
    owner: word("owner"),
  };

  function typeCatalogRow(spec: PlatformOntologyType): PanelRecord {
    const hasDetails = Boolean(platformTypeDetails[spec.id]);
    return {
      className: ONTOLOGY_TYPE,
      primaryKey: spec.id,
      label: text(spec.labelKey),
      fields: {
        typeId: spec.id,
        layer: text(`platformOntology.layers.${spec.layer}`),
        layerId: spec.layer,
        ...(hasDetails && { definition: text(`${detailKey(spec.labelKey)}.definition`) }),
      },
      fieldLabels: {
        typeId: word("typeId"),
        layer: word("layer"),
        definition: word("definition"),
      },
    };
  }

  function typeCountRow(entry: PlatformOntologyTypeCount): PanelRecord {
    const { type, status, count, reason } = entry;
    const tone = countTones[status];
    const countStatusLabel = word(`countStatus.${status}`);
    return {
      className: ONTOLOGY_TYPE,
      primaryKey: type,
      label: text(PLATFORM_ONTOLOGY_TYPE_MAP.get(type)!.labelKey),
      fields: {
        countStatus: status,
        countStatusLabel,
        countDisplay: status === "ok" ? String(count) : countStatusLabel,
        ...(status === "ok" && { count: count! }),
        ...(reason !== undefined && { countReason: reason }),
      },
      fieldLabels: {
        count: word("count"),
        countDisplay: word("count"),
        countStatusLabel: word("countStatus"),
        countReason: word("countReason"),
      },
      tones: { countStatus: tone, countStatusLabel: tone, countDisplay: tone },
    };
  }

  function relationEdge(relation: PlatformRelationKindDeclaration, target: string): PanelRecord {
    return {
      className: ONTOLOGY_RELATION_KIND,
      primaryKey: relationTargets(relation).length === 1 ? relation.id : `${relation.id}::${target}`,
      label: relationDisplay.get(relation.id)!.label,
      fields: {
        fromclass: relation.from,
        toclass: target,
        relationKind: relation.id,
        fromLabel: typeLabel(relation.from),
        toLabel: typeLabel(target),
        derived: relation.derived,
        owner: relation.owner,
      },
      fieldLabels: endpointLabels,
      tones: {
        derived: relation.derived ? "info" : "success",
      },
    };
  }

  function graphEdges(): PanelRecord[] {
    return PLATFORM_ONTOLOGY_RELATION_KINDS.flatMap(relation =>
      relationTargets(relation).map(target => relationEdge(relation, target)),
    );
  }

  function list(): PanelRecord[] {
    return PLATFORM_ONTOLOGY_LAYERS.flatMap(layer =>
      PLATFORM_ONTOLOGY_TYPES
        .filter(spec => spec.layer === layer)
        .sort((left, right) => left.labelKey.localeCompare(right.labelKey))
        .map(typeCatalogRow),
    );
  }

  async function countRows(): Promise<PanelRecord[]> {
    const { counts } = await readPlatformOntologyCounts(owner, viewer);
    return PLATFORM_ONTOLOGY_LAYERS.flatMap(layer =>
      counts
        .filter(entry => entry.layer === layer)
        .sort((left, right) => PLATFORM_ONTOLOGY_TYPE_MAP.get(left.type)!.labelKey
          .localeCompare(PLATFORM_ONTOLOGY_TYPE_MAP.get(right.type)!.labelKey))
        .map(typeCountRow),
    );
  }

  async function instanceGraphClasses(): Promise<PanelRecord[]> {
    const byType = new Map((await countRows()).map(row => [row.primaryKey, row]));
    return list().map(row => {
      const count = byType.get(row.primaryKey)!;
      return {
        ...row,
        fields: { ...row.fields, ...count.fields },
        fieldLabels: { ...row.fieldLabels, ...count.fieldLabels },
        tones: count.tones,
      };
    });
  }

  return {
    list,
    countRows,
    instanceGraphClasses,

    count(): PanelRecordQuery {
      return { rows: [], total: PLATFORM_ONTOLOGY_TYPES.length };
    },

    async graphNodes(): Promise<PanelRecord[]> {
      return (await instanceGraphClasses()).map(row => ({
        ...row,
        label: row.fields.countStatus === "ok"
          ? `${row.label} (${row.fields.countDisplay})`
          : `${row.label} · ${row.fields.countDisplay}`,
      }));
    },

    async record(type: string): Promise<PanelRecord> {
      const spec = requireType(type);
      const { counts: [count] } = await readPlatformOntologyCounts(owner, viewer, [spec]);
      const catalogRow = typeCatalogRow(spec);
      const countRow = typeCountRow(count);
      const detail = detailKey(spec.labelKey);
      const hasDetails = Boolean(platformTypeDetails[type]);
      const directory = instanceDirectories[type];
      const outputs = directory && { directoryPath: directory.path, directoryName: word(directory.name) };
      return {
        ...catalogRow,
        fields: {
          ...catalogRow.fields,
          ...countRow.fields,
          definition: hasDetails ? text(`${detail}.definition`) : word("noDefinition"),
          rules: hasDetails ? text(`${detail}.rules`) : word("noRules"),
          ...outputs,
        },
        fieldLabels: {
          ...catalogRow.fieldLabels,
          ...countRow.fieldLabels,
          definition: word("definition"),
          rules: word("rules"),
          directoryPath: word("directoryPath"),
        },
        tones: countRow.tones,
        ...(outputs && { outputs }),
      };
    },

    properties(type: string): PanelRecord[] {
      const spec = requireType(type);
      const detail = detailKey(spec.labelKey);
      return (platformTypeDetails[type]?.properties ?? []).map(property => {
        const optional = property.optional ?? false;
        return {
          primaryKey: property.name,
          label: property.name,
          fields: {
            name: property.name,
            type: property.type,
            optional,
            description: text(`${detail}.properties.${property.name}`),
          },
          tones: {
            optional: optional ? "info" : "warning",
          },
        };
      });
    },

    typeRelations(type: string): PanelRecord[] {
      requireType(type);
      const edges = graphEdges();
      return [
        ...edges.filter(row => row.fields.fromclass === type).map(row => ({
          ...row,
          fields: {
            ...row.fields,
            direction: row.fields.toclass === type ? "both" : "outgoing",
            peer: row.fields.toclass, peerLabel: row.fields.toLabel,
          },
          tones: { ...row.tones, direction: "info" as const },
        })),
        ...edges.filter(row => row.fields.toclass === type && row.fields.fromclass !== type).map(row => ({
          ...row,
          fields: { ...row.fields, direction: "incoming", peer: row.fields.fromclass, peerLabel: row.fields.fromLabel },
          tones: { ...row.tones, direction: "default" as const },
        })),
      ];
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
      return PLATFORM_ONTOLOGY_RELATION_KINDS.map((relation) => {
        const display = relationDisplay.get(relation.id)!;
        return {
          className: ONTOLOGY_RELATION_KIND,
          primaryKey: relation.id,
          label: display.label,
          subtitle: display.endpoints,
          fields: {
            id: relation.id,
            from: relation.from,
            to: relation.to,
            fromLabel: display.fromLabel, toLabel: display.toLabel, endpoints: display.endpoints,
            relationKind: relation.id,
            derived: relation.derived,
            owner: relation.owner,
          },
        };
      });
    },

    relationCount(): PanelRecordQuery {
      return { rows: [], total: PLATFORM_ONTOLOGY_RELATION_KINDS.length };
    },

    graphEdges,

    relationRecord(key: string): PanelRecord {
      const [id, target] = key.split("::");
      const relation = PLATFORM_ONTOLOGY_RELATION_KINDS.find(kind => kind.id === id);
      if (!relation) throw new HttpError(404, `Unknown relation kind: ${key}`, "OBJECT_NOT_FOUND");
      const targets = relationTargets(relation);
      if (target !== undefined && (targets.length === 1 || !targets.includes(target) || key !== `${id}::${target}`)) {
        throw new HttpError(404, `Unknown relation edge: ${key}`, "OBJECT_NOT_FOUND");
      }
      return {
        className: ONTOLOGY_RELATION_KIND,
        primaryKey: key,
        label: relationDisplay.get(id)!.label,
        fields: {
          fromObject: typeRef(relation.from),
          ...(target !== undefined || targets.length === 1
            ? { toObject: typeRef(target ?? targets[0]!) }
            : { targetObjects: targets.map(typeRef) }),
          derived: relation.derived,
          owner: relation.owner,
        },
        fieldLabels: {
          fromObject: endpointLabels.fromLabel, toObject: endpointLabels.toLabel,
          targetObjects: word("targetObjects"), derived: endpointLabels.derived, owner: endpointLabels.owner,
        },
      };
    },
  };
}
