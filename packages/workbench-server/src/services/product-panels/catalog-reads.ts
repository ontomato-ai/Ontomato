import { productPanelCatalogQuerySchema } from "@ontomato/contracts/product-catalog-query";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import { directProjectionPortsSchema, type PanelFormDescription, type PanelFormField, type PanelRecord, type PanelRecordFieldValue, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { ACTION, METRIC_VIEW, OBJECT_TYPE, ONTOLOGY_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION, RELATIONSHIP, SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import type { DirectPanelPortType } from "@ontomato/contracts/panel-manifest";
import {
  METRIC_CHART_COMPONENT, productCatalogQuerySchema,
  productPanelInputSchema, productVisibilitySchema, registerProductPanelRequestSchema, type ProductProjection, type ProductVisibility,
  registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type { ProductOwner } from "../product-governance/grants";
import { currentProductGrants, currentProductUsedBy, listCurrentProducts } from "./catalog";
import { readAuthorComponentCatalogue } from "./component-catalogue";
import { readCurrentPanel, readCurrentProjection } from "./current";

const jsonSchema = (schema: z.ZodTypeAny) => cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
const configBooleanSchema = z.boolean();
const configNumberSchema = z.number();
const configStringSchema = z.string();
const configStringArraySchema = z.array(z.string());
type FormParams = { values?: Record<string, unknown>; changedField?: string | null };
type CatalogueKind = "projection" | "panel";
const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });

function catalogueQuery(params: Record<string, unknown>) {
  const { search, size, scope, sort, cursor } = params;
  return { q: search, limit: size, scope, sort, cursor };
}

async function catalogueGrants(owner: ProductOwner, viewer: AssistantCredentials, kind: CatalogueKind, id: string) {
  const { grants } = await currentProductGrants(owner, viewer, kind, id);
  return { grants, shared: grants.some(({ principalKind, verb }) => principalKind === "domain" && verb === "use") };
}

function formFields(locale: string | undefined, editable: boolean, creating: boolean, builtin: boolean) {
  const label = (name: string) => tForLocale(locale, `panels.productCatalog.${name}`);
  const field = (path: string, schema: z.ZodTypeAny, control: PanelFormField["control"],
    { required = true, readOnly = !editable, help, labelKey = path.split("/").at(-1)!, labelText, refreshOnChange }: {
      required?: boolean; readOnly?: boolean; help?: string; labelKey?: string; labelText?: string; refreshOnChange?: boolean;
    } = {}): PanelFormField => ({
    path, label: labelText ?? label(labelKey), valueSchema: jsonSchema(schema), control, required, readOnly,
    ...(help && { help }), ...(refreshOnChange && { refreshOnChange }),
  });
  const common = productPanelInputSchema.shape;
  const visibility = builtin ? productVisibilitySchema : common.visibility;
  const fields = [
    field("/name", common.name, { kind: "text" }),
    field("/description", common.description, { kind: "text", multiline: true }),
    field("/visibility", visibility, {
      kind: "select", options: visibility.options.map(value =>
        option(value, value === "platform" ? tForLocale(locale, "panels.skill.sourcePublic") : label(value))),
    }, { readOnly: !creating }),
  ];
  return { field, fields };
}

function configurationControl(type: string): [z.ZodTypeAny, PanelFormField["control"]] {
  switch (type) {
    case "boolean": return [configBooleanSchema, { kind: "switch" }];
    case "number": return [configNumberSchema, { kind: "number" }];
    case "string": return [configStringSchema, { kind: "text" }];
    case "string[]": return [configStringArraySchema, { kind: "string-array" }];
  }
  const literals = type.split("|").map(value => /^"([^"]+)"$/.exec(value.trim())?.[1]);
  if (literals.length > 1 && literals.every(value => value !== undefined)) {
    const options = literals.map(value => option(value!, value!));
    return [z.union([z.literal(literals[0]!), z.literal(literals[1]!), ...literals.slice(2).map(value => z.literal(value!))]),
      { kind: "select", options }];
  }
  return [runtimeJsonValueSchema, { kind: "code", language: "json" }];
}

type FormField = ReturnType<typeof formFields>["field"];
function projectionConfigurationFields(field: FormField, component: ComponentDeclaration | undefined, config: unknown) {
  if (!component?.config?.length) return [
    field("/config", directProjectionPortsSchema.shape.config, { kind: "code", language: "json" }),
  ];
  const keyPath = (key: string) => `/config/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  const fields = component.config.map(property => {
    const [schema, control] = configurationControl(property.type);
    return field(keyPath(property.name), schema, control, {
      required: property.required, labelText: property.name, help: property.description,
    });
  });
  for (const key of Object.keys(runtimeJsonObjectSchema.parse(config ?? {}))) {
    if (!component.config.some(property => property.name === key))
      fields.push(field(keyPath(key), runtimeJsonValueSchema, { kind: "code", language: "json" }, { labelText: key, required: false }));
  }
  return fields;
}

function formResult(
  kind: CatalogueKind, id: string, fields: PanelFormField[], values: Record<string, unknown>, revision?: number,
): PanelFormDescription {
  const schema = kind === "panel" ? registerProductPanelRequestSchema : registerProductProjectionRequestSchema;
  return {
    fields,
    values: runtimeJsonObjectSchema.parse(values),
    errors: [],
    ...(revision !== undefined && { revision }),
    save: {
      method: "PUT",
      path: `/api/product-${kind}s/${encodeURIComponent(id)}`,
      bodySchema: jsonSchema(schema),
      draftOperation: revision === undefined ? `${kind}.create` : `${kind}.update`,
    },
  };
}

function draftId(values: Record<string, unknown> | undefined) {
  return domainProductIdSchema.parse(values?.id ?? randomUUID());
}

function commonValues({ name, description, visibility }: { name: string; description: string; visibility: ProductVisibility }) {
  return { name, description, visibility };
}

export function createProductPanelReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const record = (primaryKey: string) => readCurrentPanel(owner, viewer, primaryKey);

  function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined, values.visibility === "platform");
    const { content, manifest, template, theme } = productPanelInputSchema.shape;
    const manifestShape = manifest.innerType().shape;
    return formResult("panel", id, [
      ...fields,
      field("/template", template, { kind: "switch" }, { required: false }),
      field("/content/html", content.shape.html, { kind: "code", language: "html" }),
      field("/content/module", content.shape.module, { kind: "code", language: "javascript" }),
      field("/content/style", content.shape.style, { kind: "code", language: "text" }, { required: false }),
      field("/content/recipes", content.shape.recipes, { kind: "code", language: "markdown" }, { required: false }),
      field("/content/messages", content.shape.messages, { kind: "code", language: "json" }, { required: false }),
      field("/manifest/state", manifestShape.state, { kind: "code", language: "json" }),
      field("/manifest/members", manifestShape.members, { kind: "code", language: "json" }),
      field("/theme", theme, { kind: "code", language: "json" }, { required: false }),
    ], values, revision);
  }

  return {
    query(params: Record<string, unknown>) {
      return listCurrentProducts(owner, viewer, "panel", productPanelCatalogQuerySchema.parse({
        ...catalogueQuery(params), template: params.template,
      }));
    },
    record,
    async members(primaryKey: string) {
      return (await record(primaryKey)).manifest.members;
    },
    async memberRows(primaryKey: string): Promise<PanelRecord[]> {
      const panel = await record(primaryKey);
      const word = (key: string) => tForLocale(viewer.locale, `panels.productCatalog.application.${key}`);
      let projectionNames = new Map<string, string>();
      let panelNames = new Map<string, string>();
      try {
        const [projections, panels] = await Promise.all([
          listCurrentProducts(owner, viewer, "projection", { q: "", scope: "all", sort: "name", limit: 100 }),
          listCurrentProducts(owner, viewer, "panel", { q: "", scope: "all", sort: "name", limit: 100 }),
        ]);
        projectionNames = new Map(projections.items.map(item => [item.id, item.name || item.id]));
        panelNames = new Map(panels.items.map(item => [item.id, item.name || item.id]));
      } catch {
        // Keep IDs as labels when auxiliary lookup is unavailable.
      }
      const rows: PanelRecord[] = [];
      for (const [slotName, member] of Object.entries(panel.manifest.members)) {
        const target = member.target;
        if ("projectionId" in target) {
          const id = target.projectionId;
          const label = projectionNames.get(id) ?? id;
          rows.push({
            primaryKey: id,
            className: PRODUCT_PROJECTION,
            label,
            ...(label !== id && { subtitle: id }),
            fields: {
              slot: slotName,
              kindLabel: word("memberKindProjection"),
              target: { kind: "reference", className: PRODUCT_PROJECTION, primaryKey: id, label },
            },
            fieldLabels: {
              slot: word("memberSlot"),
              kindLabel: word("memberKind"),
              target: word("memberTarget"),
            },
            tones: { kindLabel: "default" },
          });
        } else if ("panelId" in target) {
          const id = target.panelId;
          const label = panelNames.get(id) ?? id;
          rows.push({
            primaryKey: id,
            className: PRODUCT_PANEL,
            label,
            ...(label !== id && { subtitle: id }),
            fields: {
              slot: slotName,
              kindLabel: word("memberKindPanel"),
              target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: id, label },
            },
            fieldLabels: {
              slot: word("memberSlot"),
              kindLabel: word("memberKind"),
              target: word("memberTarget"),
            },
            tones: { kindLabel: "info" },
          });
        }
      }
      return rows;
    },
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "panel", primaryKey);
    },
    grants(primaryKey: string) {
      return catalogueGrants(owner, viewer, "panel", primaryKey);
    },
    async form(primaryKey: string, params: FormParams) {
      const panel = await record(primaryKey);
      const { content, manifest, template, theme } = panel;
      return describeForm(primaryKey, { ...commonValues(panel), content, manifest, template: template ?? false,
        ...(theme !== undefined && { theme }), ...params.values }, panel.editable, panel.revision);
    },
    createForm(params: FormParams) {
      const id = draftId(params.values);
      return describeForm(id, {
        name: "", description: "", visibility: "private", template: false,
        content: {
          html: '<div id="app"><section></section></div>',
          module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
        },
        manifest: { state: {}, members: {} },
        ...params.values, id,
      }, true);
    },
  };
}

export interface ProductProjectionSummaryRow {
  id: string;
  ownerId: string | null;
  name: string;
  description: string;
  visibility: ProductVisibility;
  revision: number;
  updatedAt: string;
  editable: boolean;
  componentId: string;
}

function shortComponentName(componentId: string): string {
  return componentId.split(":").pop() || componentId || "—";
}

function formatPortType(port: DirectPanelPortType, locale: string): string {
  const word = (key: string, params?: Record<string, string | number>) =>
    tForLocale(locale, `panels.productCatalog.projection.${key}`, params);
  switch (port.kind) {
    case "object":
      return word("portObject", { objectType: port.objectType });
    case "object-union":
      return word("portObjectUnion");
    case "child-object":
      return word("portChildObject", { parentType: port.parentType, collection: port.collection });
    case "list":
      return word("portList", { items: formatPortType(port.items, locale) });
    case "scalar":
      return word("portScalar", { type: port.type });
    case "placement":
      return word("portPlacement");
    case "json":
      return word("portJson");
  }
}

function formatProjectionDataSource(
  source: ProductProjection["data"][string]["source"],
  locale: string,
): PanelRecordFieldValue {
  const word = (key: string, params?: Record<string, string | number>) =>
    tForLocale(locale, `panels.productCatalog.projection.${key}`, params);
  if ("type" in source) {
    const { kind, id } = source.type;
    if (kind === "PlatformObjectType") {
      return { kind: "reference", className: ONTOLOGY_TYPE, primaryKey: id, label: word("sourcePlatformType", { id }) };
    }
    const className = kind === "Relationship" ? RELATIONSHIP : OBJECT_TYPE;
    return { kind: "reference", className, primaryKey: id, label: word("sourceOntologyType", { id }) };
  }
  if ("literal" in source.object) {
    const { className, primaryKey } = source.object.literal;
    const label = word("sourceObject", { className, primaryKey });
    if (className === ACTION || className === METRIC_VIEW) {
      return { kind: "reference", className, primaryKey, label };
    }
    return label;
  }
  return word("sourceInput", { input: source.object.input });
}

function formatProjectionParams(
  params: ProductProjection["data"][string]["params"],
  locale: string,
): string {
  const word = (key: string, values?: Record<string, string | number>) =>
    tForLocale(locale, `panels.productCatalog.projection.${key}`, values);
  const entries = Object.entries(params ?? {});
  if (!entries.length) return word("paramsNone");
  return entries
    .map(([name, value]) => {
      if ("literal" in value) return word("paramLiteral", { name, value: JSON.stringify(value.literal) });
      return word("paramInput", { name, input: value.input });
    })
    .join("; ");
}

function formatProjectionOperationTarget(
  target: NonNullable<ProductProjection["operations"]>[string]["target"],
  locale: string,
): string {
  const word = (key: string, values?: Record<string, string | number>) =>
    tForLocale(locale, `panels.productCatalog.projection.${key}`, values);
  if (!target) return word("targetNone");
  if ("input" in target) return word("targetInput", { input: target.input });
  if ("literal" in target) {
    return word("targetLiteral", { className: target.literal.className, primaryKey: target.literal.primaryKey });
  }
  return "—";
}

function formatConfigValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

/** Project a stored projection summary or full detail onto the standard generic PanelRecord shape. */
export function toProductProjectionPanelRecord(
  row: ProductProjectionSummaryRow | ProductProjection,
  locale?: string,
  extra?: {
    ownerLabel?: string;
    componentLabel?: string;
    domainShared?: boolean;
    usedByCount?: number;
    hiddenUsedByCount?: number;
  },
): PanelRecord {
  const language = resolveLocale(locale);
  const word = (key: string) => tForLocale(language, `panels.productCatalog.projection.${key}`);
  const isDetail = "data" in row;
  const isChart = row.componentId === METRIC_CHART_COMPONENT;
  const isBuiltin = row.visibility === "platform" || row.ownerId === null;
  const componentDisplay = extra?.componentLabel || shortComponentName(row.componentId);
  const ownerDisplay = row.ownerId === null ? word("platformOwner") : (extra?.ownerLabel || row.ownerId);
  const scopeLabel = row.visibility === "platform"
    ? word("scopePlatform")
    : row.visibility === "domain"
      ? word("scopeDomain")
      : word("scopePrivate");
  const scopeTone = row.visibility === "platform" ? "info" : row.visibility === "domain" ? "success" : "default";
  const accessLabel = word(row.editable ? "editable" : "readOnly");
  const accessTone = row.editable ? "success" : "info";
  const kindLabel = word(isChart ? "kindChart" : "kindStandard");
  const kindTone = isChart ? "warning" : "info";
  const domainShared = extra?.domainShared ?? (row.visibility === "domain");

  const fields: PanelRecord["fields"] = {
    id: row.id,
    component: isDetail
      ? { kind: "reference", className: SDK_COMPONENT, primaryKey: row.componentId, label: componentDisplay }
      : componentDisplay,
    componentId: row.componentId,
    projectionKind: kindLabel,
    scope: scopeLabel,
    visibility: row.visibility,
    access: accessLabel,
    owner: ownerDisplay,
    revision: row.revision,
    updatedAt: row.updatedAt,
    ...(isDetail && {
      domainShared,
      definitionJson: JSON.stringify(row, null, 2),
    }),
  };

  const fieldLabels: NonNullable<PanelRecord["fieldLabels"]> = {
    id: word("id"),
    component: word("component"),
    projectionKind: word("kind"),
    scope: word("scope"),
    access: word("access"),
    owner: word("owner"),
    revision: word("revision"),
    updatedAt: word("updatedAt"),
    ...(isDetail && { definitionJson: word("definitionJson") }),
  };

  const outputs: PanelRecord["outputs"] = isDetail
    ? {
        canEdit: row.editable,
        canGrant: row.editable,
        canDelete: row.editable,
        canCopy: row.editable && !isChart,
        isBuiltin,
        isChart,
        domainShared,
        revision: row.revision,
        usedByCount: extra?.usedByCount ?? 0,
        hiddenUsedByCount: extra?.hiddenUsedByCount ?? 0,
      }
    : undefined;

  return {
    primaryKey: row.id,
    className: PRODUCT_PROJECTION,
    label: row.name || row.id,
    ...(row.description && { subtitle: row.description }),
    fields,
    fieldLabels,
    tones: { scope: scopeTone, access: accessTone, projectionKind: kindTone },
    ...(outputs !== undefined && { outputs }),
  };
}

export function createProductProjectionReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const rawRecord = (primaryKey: string) => readCurrentProjection(owner, viewer, primaryKey);
  const language = resolveLocale(viewer.locale);
  const word = (key: string) => tForLocale(language, `panels.productCatalog.projection.${key}`);

  async function resolveOwnerLabels(ownerIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (!ids.length) return new Map();
    try {
      const { createAgentOptionReadAdapters } = await import("../assistant/panel-reads");
      const { options } = await createAgentOptionReadAdapters(viewer).users.resolve(ids);
      return new Map(options.map(item => [item.primaryKey, item.label]));
    } catch {
      return new Map();
    }
  }

  async function resolveComponentLabels(): Promise<Map<string, string>> {
    try {
      const catalogue = await readAuthorComponentCatalogue(owner);
      return new Map([...catalogue].map(([componentId, item]) => [componentId, item.label]));
    } catch {
      return new Map();
    }
  }

  async function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number, chart = false) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined, values.visibility === "platform");
    if (chart) return formResult("projection", id, fields, values, revision);
    const components = await readAuthorComponentCatalogue(owner);
    const candidates = [...components].filter(([key, item]) => key !== METRIC_CHART_COMPONENT && item.declaration.data !== undefined);
    const component = typeof values.componentId === "string" ? components.get(values.componentId)?.declaration : undefined;
    const schema = directProjectionPortsSchema.shape;
    return formResult("projection", id, [
      ...fields,
      field("/componentId", schema.componentId, {
        kind: "select", options: candidates.map(([value, item]) => option(value, item.label)),
      }, { labelKey: "component", refreshOnChange: true }),
      field("/data", schema.data, { kind: "code", language: "json" }),
      ...projectionConfigurationFields(field, component, values.config),
      field("/inputs", schema.inputs, { kind: "code", language: "json" }),
      field("/outputs", schema.outputs, { kind: "code", language: "json" }),
      field("/operations", schema.operations, { kind: "code", language: "json" }, { required: false }),
    ], values, revision);
  }

  return {
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const listed = await listCurrentProducts(owner, viewer, "projection", productCatalogQuerySchema.parse(catalogueQuery(params)));
      const [ownerLabels, componentLabels] = await Promise.all([
        resolveOwnerLabels(listed.items.map(item => item.ownerId)),
        resolveComponentLabels(),
      ]);
      return {
        rows: listed.items.map(item => toProductProjectionPanelRecord({
          ...item,
          componentId: item.componentId ?? "",
        }, viewer.locale, {
          ownerLabel: item.ownerId ? ownerLabels.get(item.ownerId) : undefined,
          componentLabel: item.componentId ? componentLabels.get(item.componentId) : undefined,
        })),
        total: listed.total,
        ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}),
      };
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      const projection = await rawRecord(primaryKey);
      const [ownerLabels, componentLabels, domainShared, usage] = await Promise.all([
        resolveOwnerLabels([projection.ownerId]),
        resolveComponentLabels(),
        projection.editable
          ? catalogueGrants(owner, viewer, "projection", primaryKey).then(result => result.shared).catch(() => projection.visibility === "domain")
          : Promise.resolve(projection.visibility === "domain"),
        currentProductUsedBy(owner, viewer, "projection", primaryKey).catch(() => ({ panels: [], hiddenCount: 0 })),
      ]);
      return toProductProjectionPanelRecord(projection, viewer.locale, {
        ownerLabel: projection.ownerId ? ownerLabels.get(projection.ownerId) : undefined,
        componentLabel: componentLabels.get(projection.componentId),
        domainShared,
        usedByCount: usage.panels.length + usage.hiddenCount,
        hiddenUsedByCount: usage.hiddenCount,
      });
    },
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "projection", primaryKey);
    },
    async usedByRows(primaryKey: string): Promise<PanelRecord[]> {
      const usage = await currentProductUsedBy(owner, viewer, "projection", primaryKey);
      return usage.panels.map((panel): PanelRecord => {
        const label = panel.name || panel.id;
        return {
          primaryKey: panel.id,
          className: PRODUCT_PANEL,
          label,
          ...(label !== panel.id && { subtitle: panel.id }),
          fields: {
            id: panel.id,
            panel: { kind: "reference", className: PRODUCT_PANEL, primaryKey: panel.id, label },
          },
          fieldLabels: {
            id: word("usedById"),
            panel: word("usedByPanel"),
          },
        };
      });
    },
    grants(primaryKey: string) {
      return catalogueGrants(owner, viewer, "projection", primaryKey);
    },
    async grantRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      if (!projection.editable) {
        throw new HttpError(403, "Projection edit Grant required", "PRODUCT_FORBIDDEN");
      }
      const { grants } = await currentProductGrants(owner, viewer, "projection", primaryKey);
      const kindLabel = (kind: string) =>
        kind === "domain" ? word("grantDomain") : kind === "role" ? word("grantRole") : word("grantPrincipal");
      const verbLabel = (verb: string) => (verb === "edit" ? word("grantEdit") : word("grantUse"));
      return grants.map((grant): PanelRecord => {
        const isDomain = grant.principalKind === "domain";
        const displayName = isDomain ? word("grantDomain") : (grant.principalName || grant.principalId);
        const subtitle = !isDomain && grant.principalName && grant.principalName !== grant.principalId
          ? grant.principalId
          : undefined;
        return {
          primaryKey: `${grant.principalKind}:${grant.principalId}:${grant.verb}`,
          className: PRODUCT_PROJECTION,
          label: displayName,
          ...(subtitle && { subtitle }),
          fields: {
            principalKind: grant.principalKind,
            principalKindLabel: kindLabel(grant.principalKind),
            principalId: grant.principalId,
            verb: grant.verb,
            verbLabel: verbLabel(grant.verb),
            revocable: !isDomain,
          },
          fieldLabels: {
            principalKindLabel: word("grantKind"),
            verbLabel: word("grantVerb"),
          },
          tones: {
            principalKindLabel: isDomain ? "success" : "info",
            verbLabel: grant.verb === "edit" ? "warning" : "default",
          },
        };
      });
    },
    async dataRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      return Object.entries(projection.data ?? {}).map(([name, datum]): PanelRecord => ({
        primaryKey: name,
        className: PRODUCT_PROJECTION,
        label: name,
        fields: {
          source: formatProjectionDataSource(datum.source, language),
          read: datum.read,
          params: formatProjectionParams(datum.params, language),
        },
        fieldLabels: {
          source: word("dataSource"),
          read: word("dataRead"),
          params: word("dataParams"),
        },
      }));
    },
    async configRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      return Object.entries(projection.config ?? {}).map(([key, value]): PanelRecord => ({
        primaryKey: key,
        className: PRODUCT_PROJECTION,
        label: key,
        fields: {
          value: formatConfigValue(value),
        },
        fieldLabels: {
          value: word("configValue"),
        },
      }));
    },
    async inputRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      return Object.entries(projection.inputs ?? {}).map(([name, port]): PanelRecord => ({
        primaryKey: name,
        className: PRODUCT_PROJECTION,
        label: name,
        fields: {
          portType: formatPortType(port, language),
        },
        fieldLabels: {
          portType: word("portType"),
        },
      }));
    },
    async outputRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      return Object.entries(projection.outputs ?? {}).map(([name, port]): PanelRecord => ({
        primaryKey: name,
        className: PRODUCT_PROJECTION,
        label: name,
        fields: {
          portType: formatPortType(port, language),
        },
        fieldLabels: {
          portType: word("portType"),
        },
      }));
    },
    async operationRows(primaryKey: string): Promise<PanelRecord[]> {
      const projection = await rawRecord(primaryKey);
      return Object.entries(projection.operations ?? {}).map(([name, binding]): PanelRecord => {
        const opLabel = `${binding.operation.kind} · ${binding.operation.id}`;
        const operationField: PanelRecordFieldValue = binding.operation.kind === "Action"
          ? { kind: "reference", className: ACTION, primaryKey: binding.operation.id, label: opLabel }
          : opLabel;
        return {
          primaryKey: name,
          className: PRODUCT_PROJECTION,
          label: name,
          fields: {
            operation: operationField,
            target: formatProjectionOperationTarget(binding.target, language),
          },
          fieldLabels: {
            operation: word("operationRef"),
            target: word("operationTarget"),
          },
        };
      });
    },
    async form(primaryKey: string, params: FormParams) {
      const projection = await rawRecord(primaryKey);
      const { componentId, data, config, inputs, outputs, operations, conversationEntry } = projection;
      const chart = componentId === METRIC_CHART_COMPONENT;
      const values = chart ? { ...commonValues(projection), componentId } : {
        ...commonValues(projection), componentId, data, config, inputs, outputs,
        ...(operations !== undefined && { operations }), ...(conversationEntry !== undefined && { conversationEntry }),
      };
      return describeForm(primaryKey, { ...values, ...params.values }, projection.editable, projection.revision, chart);
    },
    createForm(params: FormParams) {
      const id = draftId(params.values);
      return describeForm(id, {
        name: "", description: "", visibility: "private", componentId: "",
        inputs: {}, outputs: {}, config: {}, data: {}, ...params.values, id,
      }, true);
    },
  };
}
