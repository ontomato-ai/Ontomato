import { z } from "zod";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { panelReadParameterSchemas, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import {
  platformOntologyNeighborsRequestSchema,
  type PlatformOntologyCountsResponse,
  type PlatformOntologyNeighborsRequest,
  type PlatformOntologyNeighborsResponse,
  type PlatformOntologyStartResponse,
} from "@ontomato/contracts/platform-ontology";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { ProductOwner } from "../product-governance/grants";
import { HttpError } from "../../utils/errors";
import { createPlatformOntologyCatalogueReads, createRelationKindDisplayMap } from "./catalogue-reads";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyInstance,
  readPlatformOntologyInstancePage,
  readPlatformOntologyNeighbors,
  readPlatformOntologyStart,
  platformOntologyOwnerReadError,
} from "./query";
import {
  ACTION, AGENT_DEFINITION, APPLICATION, FUNCTION, METRIC_VIEW, OBJECT_TYPE, ONTOLOGY_TYPE,
  PLATFORM_ONTOLOGY_TYPE_MAP, PRODUCT_PANEL, PRODUCT_PROJECTION, RELATIONSHIP, SDK_COMPONENT, SKILL,
} from "./schema";

const instanceSearchParams = z.object({
  className: panelReadParameterSchemas.className.optional(),
  search: panelReadParameterSchemas.keyword.optional(),
  page: panelReadParameterSchemas.page.optional(),
}).strict();
const instancesParams = instanceSearchParams.required({ className: true }).extend({
  size: panelReadParameterSchemas.size.optional(),
});
const instanceRecordParams = z.object({ object: panelReadParameterSchemas.graphNode }).strict();

const instanceDetailRoutes: Readonly<Partial<Record<string, string>>> = {
  [OBJECT_TYPE]: "/ontology/objects",
  [RELATIONSHIP]: "/ontology/relations/detail",
  [METRIC_VIEW]: "/ontology/assets/metrics/detail",
  [FUNCTION]: "/ontology/assets/functions/detail",
  [ACTION]: "/ontology/assets/actions/detail",
  [SKILL]: "/ontology/skills/detail",
  [SDK_COMPONENT]: "/ontology/components",
  [PRODUCT_PROJECTION]: "/ontology/projections/detail",
  [PRODUCT_PANEL]: "/ontology/panels/detail",
  [APPLICATION]: "/ontology/applications/detail",
  [AGENT_DEFINITION]: "/ontology/agents/detail",
};

export interface PlatformOntologyReadAdapter extends ReturnType<typeof createPlatformOntologyCatalogueReads> {
  counts(): Promise<PlatformOntologyCountsResponse>;
  start(): Promise<PlatformOntologyStartResponse>;
  neighbors(params: PlatformOntologyNeighborsRequest | Record<string, unknown>): Promise<PlatformOntologyNeighborsResponse>;
  instanceSearch(params: Record<string, unknown>): Promise<PanelRecordQuery>;
  instances(params: Record<string, unknown>): Promise<PanelRecordQuery>;
  instanceRecord(params: Record<string, unknown>): Promise<PanelRecord>;
}

/**
 * Named reads for the four-layer platform ontology and its type and relation catalogues.
 */
export function createPlatformOntologyReadAdapter(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  callerUserName?: string,
): PlatformOntologyReadAdapter {
  const relationDisplay = createRelationKindDisplayMap(viewer.locale);
  const text = (key: string) => tForLocale(viewer.locale, key);
  const word = (key: string) => text(`panels.platformOntology.${key}`);
  const baseFieldLabels = {
    label: word("instanceName"),
    typeLabel: word("typeLabel"),
    layer: word("layer"),
    primaryKey: word("primaryKey"),
    detail: word("detail"),
  };
  const typeLabelOf = (type: string) => text(PLATFORM_ONTOLOGY_TYPE_MAP.get(type)!.labelKey);
  const detailPathOf = (className: string, key: string) => {
    const route = instanceDetailRoutes[className];
    return route && panelAddress(route, { selected: key });
  };

  function instanceRow(item: Awaited<ReturnType<typeof readPlatformOntologyInstance>>, includeMetadata: boolean): PanelRecord {
    const { className, primaryKey } = item.node;
    const spec = PLATFORM_ONTOLOGY_TYPE_MAP.get(className)!;
    const metadata = includeMetadata ? item.metadata : undefined;
    return {
      className,
      primaryKey,
      label: item.label,
      fields: {
        typeLabel: text(spec.labelKey),
        layer: text(`platformOntology.layers.${spec.layer}`),
        primaryKey,
        ...(item.detail !== undefined && { detail: item.detail }),
        ...metadata,
      },
      fieldLabels: {
        ...baseFieldLabels,
        ...(metadata && Object.fromEntries(Object.keys(metadata).map(key => [key, word(key)]))),
      },
    };
  }

  async function readInstanceRows(
    input: z.infer<typeof instanceSearchParams> & { size?: number },
    includeMetadata: boolean,
  ): Promise<PanelRecordQuery> {
    const { className, page, search, size } = input;
    if (className !== undefined && !PLATFORM_ONTOLOGY_TYPE_MAP.has(className)) {
      throw new HttpError(400, `Unknown platform ontology type: ${className}`, "INVALID_PLATFORM_TYPE");
    }
    const result = await readPlatformOntologyInstancePage(owner, viewer, {
      type: className ?? ONTOLOGY_TYPE, keyword: search, page: page?.number, pageSize: size ?? page?.size,
    });
    if (result.status !== "ok") throw platformOntologyOwnerReadError(result.status, result.reason);
    const rows = result.items.map(item => {
      const row = instanceRow(item, includeMetadata);
      const detailPath = includeMetadata && detailPathOf(item.node.className, item.node.primaryKey);
      return detailPath ? { ...row, outputs: { detailPath } } : row;
    });
    return {
      rows,
      fieldLabels: Object.assign({}, baseFieldLabels, ...rows.map(row => row.fieldLabels)),
      total: result.total,
      hasMore: result.page * result.pageSize < result.total,
      ...(result.failures?.length && {
        diagnostics: result.failures.map(({ type, status }) => `${typeLabelOf(type)} · ${word(`countStatus.${status}`)}`),
      }),
    };
  }

  return {
    ...createPlatformOntologyCatalogueReads(owner, viewer),

    counts(): Promise<PlatformOntologyCountsResponse> {
      return readPlatformOntologyCounts(owner, viewer);
    },

    async start(): Promise<PlatformOntologyStartResponse> {
      return {
        node: await readPlatformOntologyStart(owner, viewer, callerUserName),
      };
    },

    async neighbors(
      params: PlatformOntologyNeighborsRequest | Record<string, unknown>,
    ): Promise<PlatformOntologyNeighborsResponse> {
      const input = platformOntologyNeighborsRequestSchema.parse(params);
      const result = await readPlatformOntologyNeighbors(owner, viewer, input, callerUserName);
      return {
        ...result,
        edges: result.edges.map((edge) => {
          const display = relationDisplay.get(edge.relationKind);
          return display ? { ...edge, label: display.label } : edge;
        }),
        relations: result.relations.map((relation) => {
          const display = relationDisplay.get(relation.relationKind);
          return display ? { ...relation, label: display.label } : relation;
        }),
      };
    },

    instanceSearch(params): Promise<PanelRecordQuery> {
      return readInstanceRows(instanceSearchParams.parse(params), false);
    },

    instances(params): Promise<PanelRecordQuery> {
      return readInstanceRows(instancesParams.parse(params), true);
    },

    async instanceRecord(params): Promise<PanelRecord> {
      const { object } = instanceRecordParams.parse(params);
      const item = await readPlatformOntologyInstance(owner, viewer, object);
      const detailPath = detailPathOf(object.className, object.primaryKey);
      return {
        ...instanceRow(item, true),
        outputs: { typeLabel: typeLabelOf(object.className), ...(detailPath && { detailPath }) },
      };
    },
  };
}
