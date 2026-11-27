import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import { productPanelCatalogQuerySchema } from "@ontomato/contracts/product-catalog-query";
import { productObjectAccessSchema } from "@ontomato/contracts/object-policy-access";
import { principalDirectoryResponseSchema, type PrincipalDirectoryRequest } from "@ontomato/contracts/principal-directory";
import { objectPublicationAccessSchema } from "@ontomato/contracts/object-publication";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  directProjectionPortsSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
  type PanelRecord,
  type PanelRecordFieldValue,
  type PanelRecordQuery,
  type PanelOptionList,
} from "@ontomato/contracts/panel-projection";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import {
  ACTION,
  APPLICATION,
  APPLICATION_PANEL_USE,
  METRIC_VIEW,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  SDK_COMPONENT,
  USER,
  platformObjectTypes,
  platformOntologyLayers,
} from "@ontomato/contracts/platform-object-types";
import type { DirectPanelPortType } from "@ontomato/contracts/panel-manifest";
import {
  METRIC_CHART_COMPONENT, currentPanelRecordSchema,
  productPanelInputSchema, productPanelUsedBySchema, productProjectionCatalogQuerySchema,
  productVisibilitySchema, projectionBoundObjectTypes, registerProductPanelRequestSchema,
  type ProductPanelUsedBy, type ProductProjection, type ProductProjectionUsedBy, type ProductVisibility,
  registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { domainProductIdSchema, isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { findCurrentProduct } from "../../infrastructure/product-current";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import { readPrincipalDirectory } from "../identity/principal-directory";
import { requireObject } from "../product-governance/authorization";
import type { ProductOwner } from "../product-governance/service-authentication";
import { readHomePanel } from "../platform-home/service";
import { platformHomeStore } from "../platform-home/store";
import {
  catalogueAuthorCandidates, catalogueObject, cataloguePanel, currentProductGrants, currentProductUsedBy, currentProjectionUsedBy, listCurrentProductNames, listCurrentProductRecords, listCurrentProducts, listCurrentProductsInRanges, listPanelPickerInRange, listProjectionFilterFacets, listUnavailablePanels,
  readCataloguePanel, readProjectionFilterFacets, readScopedPanelNames, readScopedProjectionNames, readScopedProjectionSummaries, readUnavailablePanels, requireCataloguePanelInRanges,
} from "./catalog";
import { currentDefinition, currentProductVisibility, definitionVisibleInRange, panelUseForbidden, type DefinitionVisibilityRange, type ProductUseRanges } from "./access";
import { panelDefinition, projectionDefinition } from "./render-definitions";
import { readAuthorComponentCatalogue, readAuthorComponentCatalogueInRange } from "./component-catalogue";
import { loadCurrentProduct, readCurrentContentInRange, readCurrentPanel, readCurrentProjection } from "./current";
import { panelUsersInRange, panelsUsingPanelInRange, panelsUsingProjectionInRange } from "./used-by";
import type { JavaPanelRead, JavaPanelReadResult, PanelReadRanges, PanelReadVisibility, PreparedOwnerReadFacts } from "./java-panel-reads";
import { localReadRegistration, ownerFactsRegistration, ownerReadRegistration, type RegisteredDataReadRegistration, type RegisteredLocalDataRead } from "./registered-data-read";
import type { PanelReadSelection } from "./registered-data-read";
import {
  addProjectionGraphReferences, assetGraphNode, createAssetGraph, objectTypeGraphNode, panelGraphMembers, resolveObjectTypeLabel,
} from "./asset-graph";

const jsonSchema = (schema: z.ZodTypeAny) => cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
const configBooleanSchema = z.boolean();
const configNumberSchema = z.number();
const configStringSchema = z.string();
const configStringArraySchema = z.array(z.string());
type FormParams = { values?: Record<string, unknown>; changedField?: string | null };
type CatalogueKind = "projection" | "panel";
const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });

type PanelPickerPage = { number: number; size: number };

async function panelPickerOptions(
  keyword: string | undefined, page: PanelPickerPage | undefined,
  list: (input: z.output<typeof productPanelCatalogQuerySchema>, picker: { offset: number }) => ReturnType<typeof listCurrentProducts>,
): Promise<PanelOptionList> {
  const input = productPanelCatalogQuerySchema.parse({ q: keyword, limit: page?.size });
  const { items, total } = await list(input, { offset: ((page?.number ?? 1) - 1) * input.limit });
  return { options: items.map(({ id, name }) => ({ primaryKey: id, value: id, label: name })), total };
}

export function readScopedPanelPickerOptions(
  owner: ProductOwner, use: DefinitionVisibilityRange, keyword?: string, page?: PanelPickerPage,
) {
  return panelPickerOptions(keyword, page, (input, picker) => listPanelPickerInRange(owner, input, picker, use));
}

function toReferenceGraphRecord(primaryKey: string, className: string, label: string, graph: ProductGraph): PanelRecord {
  return {
    primaryKey,
    className,
    label,
    fields: {
      graph: { kind: "json", value: graph },
    },
  };
}

function catalogueQuery(params: Record<string, unknown>) {
  const { search, size, scope, sort, cursor } = params;
  return { q: search, limit: size, scope, sort, cursor };
}

function panelCatalogueInput(params: Record<string, unknown>) {
  return productPanelCatalogQuerySchema.parse({ ...catalogueQuery(params), template: params.template });
}

function projectionCatalogueInput(params: Record<string, unknown>) {
  return productProjectionCatalogQuerySchema.parse({
    ...catalogueQuery(params), componentId: params.componentId, objectType: params.objectType,
  });
}

type CataloguePage = Awaited<ReturnType<typeof listCurrentProducts>>;

function catalogueGrants(owner: ProductOwner, viewer: AssistantCredentials, kind: CatalogueKind, id: string) {
  return currentProductGrants(owner, viewer, kind, id);
}

async function policyGrantRows(
  owner: ProductOwner, viewer: AssistantCredentials, kind: CatalogueKind, id: string, label: (key: string) => string,
): Promise<PanelRecord[]> {
  return presentPolicyGrantRows(await catalogueGrants(owner, viewer, kind, id), kind, label);
}

function presentPolicyGrantRows(
  { grants, shared }: z.infer<typeof productObjectAccessSchema>, kind: CatalogueKind, label: (key: string) => string,
): PanelRecord[] {
  const className = kind === "panel" ? PRODUCT_PANEL : PRODUCT_PROJECTION;
  const rows = grants.map(({ policyId, name, verb }): PanelRecord => ({
    primaryKey: `${policyId}:${verb}`,
    className,
    label: name || policyId,
    fields: { policyId, verb, verbLabel: label(verb === "EDIT" ? "grantEdit" : "grantUse"), revocable: true },
    fieldLabels: { verbLabel: label("grantVerb") },
    tones: { verbLabel: verb === "EDIT" ? "warning" : "default" },
  }));
  if (shared) rows.push({
    primaryKey: "domain",
    className,
    label: label("grantDomain"),
    fields: { verb: "USE", verbLabel: label("grantUse"), revocable: false },
  });
  return rows;
}

function formFields(locale: string | undefined, editable: boolean, creating: boolean, builtin: boolean, audience: unknown) {
  const label = (name: string) => tForLocale(locale, `panels.productCatalog.${name}`);
  const field = (path: string, schema: z.ZodTypeAny, control: PanelFormField["control"],
    { required = true, readOnly = !editable, help, labelKey = path.split("/").at(-1)!, labelText, refreshOnChange }: {
      required?: boolean; readOnly?: boolean; help?: string; labelKey?: string; labelText?: string; refreshOnChange?: boolean;
    } = {}): PanelFormField => ({
    path, label: labelText ?? label(labelKey), valueSchema: jsonSchema(schema), control, required, readOnly,
    ...(help && { help }), ...(refreshOnChange && { refreshOnChange }),
  });
  const common = productPanelInputSchema.shape;
  const publicationLabel = (name: string) => tForLocale(locale, `panels.agentForm.publication.${name}`);
  const fields = [
    field("/name", common.name, { kind: "text" }),
    field("/description", common.description, { kind: "text", multiline: true }),
  ];
  if (creating) {
    fields.push(field("/publicationAccess/kind", z.enum(["domain", "policy"]), {
      kind: "select", options: ["domain", "policy"].map(value => option(value, publicationLabel(value))),
    }, { labelText: publicationLabel("label"), refreshOnChange: true }));
    if (audience && typeof audience === "object" && "kind" in audience && audience.kind === "policy")
      fields.push(field("/publicationAccess/policyId", objectPublicationAccessSchema.options[1].shape.policyId,
        { kind: "text" }, { labelText: publicationLabel("policyId") }));
  } else if (builtin) {
    fields.push(field("/visibility", productVisibilitySchema, { kind: "text" }, { readOnly: true }));
  }
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
    },
  };
}

function draftId(values: Record<string, unknown> | undefined) {
  return domainProductIdSchema.parse(values?.id ?? randomUUID());
}

function commonValues({ name, description, visibility }: { name: string; description: string; visibility: ProductVisibility }) {
  return { name, description, visibility };
}

async function resolveOwnerNames(
  ownerIds: readonly (string | null | undefined)[],
  viewer: AssistantCredentials,
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ownerIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!uniqueIds.length) return new Map();
  const { options } = await readPrincipalDirectory(viewer, { kind: "member", ids: uniqueIds });
  return new Map(options.map(({ id, name }) => [id, name]));
}

function visibilityLabel(locale: string | undefined, visibility: ProductVisibility): string {
  if (visibility === "platform") return tForLocale(locale, "panels.skill.sourcePublic");
  return tForLocale(locale, `panels.productCatalog.${visibility}`);
}

function visibilityTone(visibility: ProductVisibility): "success" | "info" | "default" {
  if (visibility === "domain") return "success";
  if (visibility === "platform") return "info";
  return "default";
}

function formatBindingMap(bindings: Readonly<Record<string, unknown>> | undefined): string {
  const entries = Object.entries(bindings ?? {});
  if (!entries.length) return "—";
  return entries.map(([name, value]) => {
    if (!value || typeof value !== "object") return `${name}: ${String(value)}`;
    if ("state" in value) return `${name}: state ${value.state}${"field" in value ? `.${value.field}` : ""}`;
    if ("literal" in value) return `${name}: ${JSON.stringify((value as { literal: unknown }).literal)}`;
    if ("item" in value) return `${name}: row`;
    return name;
  }).join(" · ");
}

type CurrentPanelRecord = z.infer<typeof currentPanelRecordSchema>;
type ListedPanelSummary = {
  id: string;
  ownerId: string | null;
  name: string;
  description: string;
  visibility: ProductVisibility;
  revision: number;
  updatedAt: string;
  editable: boolean;
  template?: boolean;
  memberCount?: number;
};

function panelSourceEntries(panel: CurrentPanelRecord): { path: string; content: string }[] {
  const entries: { path: string; content: string }[] = [
    { path: "panel.html", content: panel.content.html },
    { path: "panel.mjs", content: panel.content.module ?? "" },
  ];
  if (panel.content.style) {
    entries.push({ path: "panel.css", content: panel.content.style });
  }
  if (panel.content.recipes) {
    entries.push({ path: "recipes.md", content: panel.content.recipes });
  }
  if (panel.content.messages && Object.keys(panel.content.messages).length > 0) {
    entries.push({ path: "messages.json", content: JSON.stringify(panel.content.messages, null, 2) });
  }
  entries.push({ path: "manifest.json", content: JSON.stringify(panel.manifest, null, 2) });
  if (panel.theme !== undefined) {
    entries.push({ path: "theme.json", content: JSON.stringify(panel.theme, null, 2) });
  }
  return entries;
}

async function homePanelRecord(
  owner: ProductOwner, locale: string | undefined,
  readPanel: (id: string) => Promise<{ id: string; name: string; description: string } | null>,
): Promise<PanelRecord> {
  const panelWord = (key: string) => tForLocale(locale, `panels.productCatalog.panel.${key}`);
  const homePanelId = await platformHomeStore.homePanelId(owner);
  const defaultHome: PanelRecord = {
    primaryKey: "default",
    className: PRODUCT_PANEL,
    label: panelWord("defaultHome"),
    fields: {
      panelId: "",
      panelName: panelWord("defaultHome"),
      isCustomHome: false,
      unavailable: false,
      unavailableReason: "",
    },
    outputs: {
      isCustomHome: false,
      panelId: "",
      unavailable: false,
    },
  };
  if (!homePanelId) return defaultHome;
  try {
    const panel = await readPanel(homePanelId);
    if (!panel) return defaultHome;
    const label = panel.name || panel.id;
    return {
      primaryKey: panel.id,
      className: PRODUCT_PANEL,
      label,
      ...(panel.description ? { subtitle: panel.description } : {}),
      fields: {
        panelId: panel.id,
        panelName: label,
        isCustomHome: true,
        unavailable: false,
        unavailableReason: "",
      },
      outputs: {
        isCustomHome: true,
        panelId: panel.id,
        unavailable: false,
      },
    };
  } catch (error) {
    const reason = error instanceof Error && error.message
      ? error.message
      : panelWord("homeUnavailable");
    return {
      primaryKey: homePanelId,
      className: PRODUCT_PANEL,
      label: homePanelId,
      fields: {
        panelId: homePanelId,
        panelName: homePanelId,
        isCustomHome: true,
        unavailable: true,
        unavailableReason: reason,
      },
      outputs: {
        isCustomHome: true,
        panelId: homePanelId,
        unavailable: true,
      },
    };
  }
}

export function readRegisteredHomePanel(owner: ProductOwner, locale: string | undefined, range: DefinitionVisibilityRange) {
  return homePanelRecord(owner, locale, async id => {
    const row = await findCurrentProduct(owner.domainId, "panel", id);
    if (!row) throw new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE");
    if (!definitionVisibleInRange(row, range, owner.domainId)) throw panelUseForbidden(locale);
    return panelDefinition(row, false);
  });
}

type PanelMemberLabels = {
  projections: ReadonlyMap<string, { name: string; description: string | null; componentId?: string | null }>;
  panels: ReadonlyMap<string, string>;
};

type PanelCatalogueContent = {
  record(id: string): ReturnType<typeof readCurrentPanel>;
  memberLabels(panel: CurrentPanelRecord): Promise<PanelMemberLabels>;
  usage(id: string): Promise<ProductPanelUsedBy>;
  graphUsage(id: string): Promise<ProductPanelUsedBy>;
  graphLabels(panel: CurrentPanelRecord): Promise<{ projections: ReadonlyMap<string, string>; panels: ReadonlyMap<string, string> }>;
  unavailable(): ReturnType<typeof listUnavailablePanels>;
};

function panelCatalogueContent(owner: ProductOwner, viewer: AssistantCredentials): PanelCatalogueContent {
  const usage = async (id: string) => productPanelUsedBySchema.parse(await currentProductUsedBy(owner, viewer, "panel", id));
  return {
    record: id => readCurrentPanel(owner, viewer, id),
    async memberLabels() {
      const [projections, panels] = await Promise.all([
        listCurrentProductRecords(owner, viewer, "projection"),
        listCurrentProductNames(owner, viewer, "panel"),
      ]);
      return { projections: new Map([...projections].map(([id, item]) => [id, {
        name: item.name || id, description: item.description, componentId: item.componentId,
      }])), panels };
    },
    usage,
    graphUsage: id => usage(id).catch(() => ({ applicationEntries: [], panels: [], classNames: [], hiddenCount: 0 })),
    async graphLabels() {
      const [projections, panels] = await Promise.all([
        listCurrentProductNames(owner, viewer, "projection"),
        listCurrentProductNames(owner, viewer, "panel"),
      ]);
      return { projections, panels };
    },
    unavailable: () => listUnavailablePanels(owner, viewer),
  };
}

export function createScopedProductPanelReads(
  owner: ProductOwner, viewer: AssistantCredentials, range: ProductUseRanges, projectionUse?: DefinitionVisibilityRange,
  applicationEntries?: unknown,
) {
  const management = { USE: range.USE, EDIT: range.EDIT! };
  const graphUsage = (id: string) => panelUsersInRange(owner.domainId, id, range.USE, applicationEntries, viewer.locale);
  return createProductPanelReadAdapter(owner, viewer, {
    async record(id) {
      const { row, editable } = await readCurrentContentInRange(owner.domainId, "panel", id, range, viewer.locale);
      return panelDefinition(row, editable);
    },
    async memberLabels(panel) {
      const targets = Object.values(panel.manifest.members).map(({ target }) => target);
      const [projections, panels] = await Promise.all([
        readScopedProjectionSummaries(owner.domainId, targets.flatMap(target => "projectionId" in target ? [target.projectionId] : []), projectionUse!),
        readScopedPanelNames(owner.domainId, targets.flatMap(target => "panelId" in target ? [target.panelId] : []), management),
      ]);
      return { projections, panels };
    },
    async usage(id) {
      await requireCataloguePanelInRanges(owner.domainId, id, management);
      return graphUsage(id);
    },
    graphUsage,
    async graphLabels(panel) {
      const members = panelGraphMembers(panel);
      const [projections, panels] = await Promise.all([
        readScopedProjectionNames(owner.domainId, members.filter(member => member.kind === "projection").map(member => member.id), projectionUse!),
        readScopedPanelNames(owner.domainId, members.filter(member => member.kind === "panel").map(member => member.id), management),
      ]);
      return { projections, panels };
    },
    unavailable: () => readUnavailablePanels(currentProductVisibility("panel", owner.domainId, range.USE, range.EDIT)),
  });
}

export function createProductPanelReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, content = panelCatalogueContent(owner, viewer),
) {
  const rawRecord = content.record;
  const locale = viewer.locale;
  const catalogWord = (key: string) => tForLocale(locale, `panels.productCatalog.${key}`);
  const appWord = (key: string) => tForLocale(locale, `panels.productCatalog.application.${key}`);
  const panelWord = (key: string) => tForLocale(locale, `panels.productCatalog.panel.${key}`);

  function ownerDisplayName(ownerId: string | null, ownerNames: ReadonlyMap<string, string>): string {
    if (ownerId === null) return appWord("platformOwner");
    return ownerNames.get(ownerId) ?? "";
  }

  function toPanelSummaryRecord(item: ListedPanelSummary, ownerNames: ReadonlyMap<string, string>): PanelRecord {
    const isTemplate = Boolean(item.template);
    const editableLabel = item.editable ? panelWord("editable") : appWord("readOnly");
    return {
      primaryKey: item.id,
      className: PRODUCT_PANEL,
      label: item.name || item.id,
      ...(item.description ? { subtitle: item.description } : {}),
      fields: {
        id: item.id,
        owner: ownerDisplayName(item.ownerId, ownerNames),
        visibility: visibilityLabel(locale, item.visibility),
        visibilityKind: item.visibility,
        template: panelWord(isTemplate ? "templateYes" : "templateNo"),
        isTemplate,
        editable: editableLabel,
        memberCount: item.memberCount ?? 0,
        revision: item.revision,
        updatedAt: item.updatedAt,
      },
      fieldLabels: {
        id: panelWord("id"),
        owner: appWord("owner"),
        visibility: catalogWord("visibility"),
        template: panelWord("templateKind"),
        editable: panelWord("access"),
        memberCount: catalogWord("members"),
        revision: panelWord("revision"),
        updatedAt: appWord("updatedAt"),
      },
      tones: {
        visibility: visibilityTone(item.visibility),
        template: isTemplate ? "info" : "default",
        editable: item.editable ? "success" : "info",
      },
    };
  }

  function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined, values.visibility === "platform", values.publicationAccess);
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

  function presentRecord(
    result: ReturnType<typeof cataloguePanel>, ownerLabel: string | undefined, domainShared: boolean | undefined, hiddenUsedByCount: number,
  ): PanelRecord {
    const { panel, unavailable } = result;
    if (unavailable) {
      const { id, reason, revision } = unavailable;
      const diagnostics = {
        unavailable: true,
        unavailableReason: reason,
        ...(revision !== undefined && { revision }),
        canEdit: false,
        canGrant: false,
        canDelete: Boolean(revision),
        isBuiltin: isBuiltinProductId(id),
        isTemplate: false,
        ...(domainShared !== undefined && { domainShared }),
        hiddenUsedByCount: 0,
      };
      return {
        primaryKey: id,
        className: PRODUCT_PANEL,
        label: id,
        subtitle: reason,
        fields: { id, objectType: PRODUCT_PANEL, ...diagnostics },
        fieldLabels: {
          id: panelWord("id"),
          unavailableReason: panelWord("unavailableReason"),
          revision: panelWord("revision"),
          objectType: panelWord("objectType"),
        },
        tones: { unavailableReason: "danger" },
        outputs: diagnostics,
      };
    }
    const isBuiltin = isBuiltinProductId(panel.id);
    const isTemplate = Boolean(panel.template);
    const editableLabel = panel.editable ? panelWord("editable") : appWord("readOnly");
    return {
      primaryKey: panel.id,
      className: PRODUCT_PANEL,
      label: panel.name || panel.id,
      ...(panel.description ? { subtitle: panel.description } : {}),
      fields: {
        id: panel.id,
        name: panel.name,
        description: panel.description || "—",
        owner: panel.ownerId === null ? appWord("platformOwner") : ownerLabel ?? panel.ownerId,
        visibility: visibilityLabel(locale, panel.visibility),
        template: panelWord(isTemplate ? "templateYes" : "templateNo"),
        editable: editableLabel,
        revision: panel.revision,
        updatedAt: panel.updatedAt,
        createdAt: panel.createdAt,
        objectType: PRODUCT_PANEL,
        ...(domainShared !== undefined && { domainShared }),
        hiddenUsedByCount,
        unavailable: false,
        unavailableReason: "",
      },
      fieldLabels: {
        id: panelWord("id"),
        name: catalogWord("name"),
        description: catalogWord("description"),
        owner: appWord("owner"),
        visibility: catalogWord("visibility"),
        template: panelWord("templateKind"),
        editable: panelWord("access"),
        revision: panelWord("revision"),
        updatedAt: appWord("updatedAt"),
        createdAt: panelWord("createdAt"),
        objectType: panelWord("objectType"),
      },
      tones: {
        visibility: visibilityTone(panel.visibility),
        template: isTemplate ? "info" : "default",
        editable: panel.editable ? "success" : "info",
      },
      outputs: {
        canEdit: panel.editable,
        canGrant: panel.editable,
        canDelete: panel.editable,
        isBuiltin,
        isTemplate,
        ...(domainShared !== undefined && { domainShared }),
        revision: panel.revision,
        hiddenUsedByCount,
        unavailable: false,
        unavailableReason: "",
      },
    };
  }

  function presentQuery(listed: CataloguePage, ownerNames: ReadonlyMap<string, string>): PanelRecordQuery {
    const diagnostics = listed.unavailableItems?.map(item => item.id + ": " + item.reason);
    return {
      rows: listed.items.map(item => toPanelSummaryRecord(item, ownerNames)),
      ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}),
      ...(listed.total !== undefined && { total: listed.total }),
      ...(diagnostics?.length ? { diagnostics } : {}),
    };
  }

  function presentCreateForm(params: FormParams) {
    const id = draftId(params.values);

    return describeForm(id, {
      name: "", description: "", visibility: "private", publicationAccess: { kind: "domain" }, template: false,
      content: {
        html: '<div id="app"><section></section></div>',
        module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
      },
      manifest: { state: {}, members: {} },
      ...params.values, id,
    }, true);
  }

  return {
    options: (keyword?: string, page?: PanelPickerPage) =>
      panelPickerOptions(keyword, page, (input, picker) => listCurrentProducts(owner, viewer, "panel", input, picker)),
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const listed = await listCurrentProducts(owner, viewer, "panel", panelCatalogueInput(params));
      return presentQuery(listed, await resolveOwnerNames(listed.items.map(item => item.ownerId), viewer));
    },
    presentQuery,
    async unavailable(): Promise<PanelRecord[]> {
      return (await content.unavailable()).map(({ id, reason, revision }) => ({
        primaryKey: id,
        className: PRODUCT_PANEL,
        label: id,
        subtitle: reason,
        fields: { id, reason, ...(revision !== undefined && { revision }), canDelete: Boolean(revision) },
        fieldLabels: {
          id: panelWord("id"),
          reason: panelWord("unavailableReason"),
          revision: panelWord("revision"),
          canDelete: panelWord("canDelete"),
        },
        tones: { reason: "danger" },
      }));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      const result = await readCataloguePanel(owner, viewer, primaryKey);
      if (result.unavailable) return presentRecord(result, undefined, false, 0);
      const { panel } = result;
      const [ownerNames, domainShared, hiddenUsedByCount] = await Promise.all([
        resolveOwnerNames([panel.ownerId], viewer),
        panel.editable
          ? catalogueGrants(owner, viewer, "panel", primaryKey).then(result => result.shared)
          : false,
        currentProductUsedBy(owner, viewer, "panel", primaryKey).then(usage => usage.hiddenCount).catch(() => 0),
      ]);
      return presentRecord(result, panel.ownerId === null ? undefined : ownerNames.get(panel.ownerId) ?? "", domainShared, hiddenUsedByCount);
    },
    presentRecord,
    async members(primaryKey: string) {
      return (await rawRecord(primaryKey)).manifest.members;
    },
    async memberRows(primaryKey: string): Promise<PanelRecord[]> {
      const panel = await rawRecord(primaryKey);
      const { projections: projectionsById, panels: panelNames } = await content.memberLabels(panel);
      const fieldLabels = {
        slot: appWord("memberSlot"),
        kindLabel: appWord("memberKind"),
        target: appWord("memberTarget"),
        componentId: panelWord("memberComponent"),
        inputs: catalogWord("inputs"),
        outputs: catalogWord("outputs"),
      };
      const rows: PanelRecord[] = [];
      for (const [slotName, member] of Object.entries(panel.manifest.members)) {
        const target = member.target;
        const inputs = formatBindingMap(member.inputs);
        const outputs = formatBindingMap(member.outputs);
        if ("projectionId" in target) {
          const id = target.projectionId;
          const info = projectionsById.get(id);
          const label = info?.name ?? id;
          const subtitle = info?.description || (label !== id ? id : undefined);
          rows.push({
            primaryKey: id,
            className: PRODUCT_PROJECTION,
            label,
            ...(subtitle && { subtitle }),
            fields: {
              slot: slotName,
              kindLabel: appWord("memberKindProjection"),
              target: { kind: "reference", className: PRODUCT_PROJECTION, primaryKey: id, label },
              componentId: info?.componentId ?? "—",
              inputs,
              outputs,
            },
            fieldLabels,
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
              kindLabel: appWord("memberKindPanel"),
              target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: id, label },
              componentId: "—",
              inputs,
              outputs,
            },
            fieldLabels,
            tones: { kindLabel: "info" },
          });
        } else if ("fromState" in target) {
          const candidates = target.candidates;
          const referenceText = "panelIds" in candidates
            ? candidates.panelIds.join(", ")
            : "projectionIds" in candidates
              ? candidates.projectionIds.join(", ")
              : `${target.fromState}: ${candidates.rule}`;
          rows.push({
            primaryKey: slotName,
            className: PRODUCT_PANEL,
            label: referenceText,
            fields: {
              slot: slotName,
              kindLabel: panelWord("memberKindCandidate"),
              target: referenceText,
              componentId: "—",
              inputs,
              outputs,
            },
            fieldLabels,
            tones: { kindLabel: "warning" },
          });
        } else if ("fromPlatform" in target) {
          rows.push({
            primaryKey: slotName,
            className: PRODUCT_PANEL,
            label: target.fromPlatform,
            fields: {
              slot: slotName,
              kindLabel: panelWord("memberKindEntry"),
              target: target.fromPlatform,
              componentId: "—",
              inputs,
              outputs,
            },
            fieldLabels,
            tones: { kindLabel: "info" },
          });
        }
      }
      return rows;
    },
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "panel", primaryKey);
    },
    async usedByRows(primaryKey: string): Promise<PanelRecord[]> {
      const usage = await content.usage(primaryKey);
      const fieldLabels = {
        kindLabel: panelWord("usageKind"),
        target: panelWord("usageTarget"),
        path: panelWord("usagePath"),
      };
      const rows: PanelRecord[] = [];
      for (const entry of usage.applicationEntries) {
        rows.push({
          primaryKey: entry.path,
          className: APPLICATION_PANEL_USE,
          label: entry.applicationName,
          subtitle: entry.path,
          fields: {
            kindLabel: panelWord("usageEntry"),
            usageKind: "entry",
            target: { kind: "reference", className: APPLICATION, primaryKey: entry.applicationId, label: entry.applicationName },
            path: entry.path,
            canOpenPath: true,
          },
          fieldLabels,
          tones: { kindLabel: "info" },
        });
      }
      for (const item of usage.panels) {
        rows.push({
          primaryKey: item.id,
          className: PRODUCT_PANEL,
          label: item.name,
          ...(item.name !== item.id && { subtitle: item.id }),
          fields: {
            kindLabel: panelWord("usagePanel"),
            usageKind: "panel",
            target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: item.id, label: item.name },
            path: item.id,
            canOpenPath: false,
          },
          fieldLabels,
          tones: { kindLabel: "default" },
        });
      }
      for (const className of usage.classNames) {
        rows.push({
          primaryKey: className,
          className: OBJECT_TYPE,
          label: className,
          fields: {
            kindLabel: panelWord("usageClass"),
            usageKind: "class",
            target: { kind: "reference", className: OBJECT_TYPE, primaryKey: className, label: className },
            path: className,
            canOpenPath: false,
          },
          fieldLabels,
          tones: { kindLabel: "success" },
        });
      }
      return rows;
    },
    async referenceGraph(primaryKey: string): Promise<PanelRecord> {
      const panel = await rawRecord(primaryKey);
      const [usage, { projections: projectionNames, panels: panelNames }] = await Promise.all([
        content.graphUsage(primaryKey), content.graphLabels(panel),
      ]);
      const graph = createAssetGraph();
      const center = assetGraphNode("panel", panel);
      graph.addNode(center);
      for (const { id, kind } of panelGraphMembers(panel)) {
        const names = kind === "projection" ? projectionNames : panelNames;
        const node = assetGraphNode(kind, { id, name: names.get(id) ?? id });
        graph.addNode(node);
        graph.addEdge(center.id, node.id, "contains");
      }
      for (const entry of usage.applicationEntries) {
        const node = assetGraphNode("application", { id: entry.applicationId, name: entry.applicationName });
        graph.addNode(node);
        graph.addEdge(node.id, center.id, "navigates");
      }
      for (const parent of usage.panels) {
        if (parent.id === panel.id) continue;
        const node = assetGraphNode("panel", { id: parent.id, name: parent.name });
        graph.addNode(node);
        graph.addEdge(node.id, center.id, "contains");
      }
      for (const className of usage.classNames) {
        const node = objectTypeGraphNode(className, resolveObjectTypeLabel(className, resolveLocale(viewer.locale)) ?? className);
        graph.addNode(node);
        graph.addEdge(center.id, node.id, "renders", "ontology");
      }
      return toReferenceGraphRecord(panel.id, PRODUCT_PANEL, panel.name || panel.id, graph.build());
    },
    grants(primaryKey: string) {
      return catalogueGrants(owner, viewer, "panel", primaryKey);
    },
    grantRows(primaryKey: string) {
      return policyGrantRows(owner, viewer, "panel", primaryKey, appWord);
    },
    async sourceFiles(primaryKey: string): Promise<PanelRecord[]> {
      const panel = await rawRecord(primaryKey);
      return panelSourceEntries(panel).map(({ path }) => ({
        primaryKey: path,
        className: PRODUCT_PANEL,
        label: path,
        fields: { path },
        fieldLabels: { path: panelWord("usagePath") },
      }));
    },
    async sourceFile(primaryKey: string, path: string): Promise<PanelRecord> {
      const panel = await rawRecord(primaryKey);
      const found = panelSourceEntries(panel).find(entry => entry.path === path);
      if (!found) {
        throw new HttpError(404, `Source file '${path}' not found`, "PANEL_SOURCE_FILE_NOT_FOUND");
      }
      return {
        primaryKey: found.path,
        className: PRODUCT_PANEL,
        label: found.path,
        fields: {
          content: found.content || panelWord("sourceEmpty"),
        },
        fieldLabels: {
          content: panelWord("sourceContent"),
        },
      };
    },
    homePanel: () => homePanelRecord(owner, locale, () => readHomePanel(owner, viewer)),
    async form(primaryKey: string, params: FormParams) {
      const panel = await rawRecord(primaryKey);
      const { content, manifest, template, theme } = panel;
      return describeForm(primaryKey, { ...commonValues(panel), content, manifest, template: template ?? false,
        ...(theme !== undefined && { theme }), ...params.values }, panel.editable, panel.revision);
    },
    async createForm(params: FormParams) {
      await requireObject({ create: "PANEL" }, viewer);
      return presentCreateForm(params);
    },
    presentCreateForm,
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
  objectTypes?: readonly string[];
}

function shortComponentName(componentId: string): string {
  return componentId.split(":").pop() || componentId || "—";
}

function formatBoundObjectTypes(typeIds: readonly string[], language: string): string | undefined {
  if (!typeIds.length) return undefined;
  const labels = typeIds.map(id => resolveObjectTypeLabel(id, language) ?? id);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
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
    case "grid-layout": {
      const details = [
        port.columns !== undefined ? `columns<=${port.columns}` : "",
        port.maxRowSpan !== undefined ? `maxRowSpan<=${port.maxRowSpan}` : "",
        port.groupIds ? `groups=[${port.groupIds.join(", ")}]` : "",
        port.itemIds ? `items=[${port.itemIds.join(", ")}]` : "",
      ].filter(Boolean);
      const base = word("portGridLayout");
      return details.length ? `${base} (${details.join("; ")})` : base;
    }
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
  const isChart = row.componentId === METRIC_CHART_COMPONENT && row.visibility !== "platform";
  const isBuiltin = row.visibility === "platform" || isBuiltinProductId(row.id);
  const componentDisplay = extra?.componentLabel || shortComponentName(row.componentId);
  const ownerDisplay = row.ownerId === null ? word("platformOwner") : (extra?.ownerLabel ?? "");
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
  const domainShared = extra?.domainShared;
  const boundObjectTypes = isDetail ? projectionBoundObjectTypes(row) : (row.objectTypes ?? []);
  const objectTypesDisplay = formatBoundObjectTypes(boundObjectTypes, language);

  const fields: PanelRecord["fields"] = {
    id: row.id,
    component: isDetail
      ? { kind: "reference", className: SDK_COMPONENT, primaryKey: row.componentId, label: componentDisplay }
      : componentDisplay,
    componentId: row.componentId,
    ...(objectTypesDisplay !== undefined && { objectTypes: objectTypesDisplay }),
    projectionKind: kindLabel,
    scope: scopeLabel,
    visibility: row.visibility,
    access: accessLabel,
    owner: ownerDisplay,
    revision: row.revision,
    updatedAt: row.updatedAt,
    ...(isDetail && {
      ...(domainShared !== undefined && { domainShared }),
      definitionJson: JSON.stringify(row, null, 2),
    }),
  };

  const fieldLabels: NonNullable<PanelRecord["fieldLabels"]> = {
    id: word("id"),
    component: word("component"),
    objectTypes: word("objectType"),
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
        ...(domainShared !== undefined && { domainShared }),
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

type ProjectionCatalogueContent = {
  record(id: string): ReturnType<typeof readCurrentProjection>;
  facets(): ReturnType<typeof listProjectionFilterFacets>;
  components(): ReturnType<typeof readAuthorComponentCatalogue>;
  usage(id: string): Promise<ProductProjectionUsedBy>;
  graphUsage(id: string): Promise<ProductProjectionUsedBy>;
};

function projectionCatalogueContent(owner: ProductOwner, viewer: AssistantCredentials): ProjectionCatalogueContent {
  const usage = (id: string) => currentProjectionUsedBy(owner, viewer, id);
  return {
    record: id => readCurrentProjection(owner, viewer, id),
    facets: () => listProjectionFilterFacets(owner, viewer),
    components: () => readAuthorComponentCatalogue(owner, viewer),
    usage,
    graphUsage: id => usage(id).catch(() => ({ panels: [], hiddenCount: 0 })),
  };
}

export function createScopedProductProjectionReads(
  owner: ProductOwner, viewer: AssistantCredentials, range: ProductUseRanges,
  componentUse?: DefinitionVisibilityRange, panelUse?: DefinitionVisibilityRange,
) {
  const graphUsage = (id: string) => panelsUsingProjectionInRange(owner.domainId, id, panelUse!);
  return createProductProjectionReadAdapter(owner, viewer, {
    async record(id) {
      const { row, editable } = await readCurrentContentInRange(owner.domainId, "projection", id, range, viewer.locale);
      return projectionDefinition(row, editable);
    },
    facets: () => readProjectionFilterFacets(currentProductVisibility("projection", owner.domainId, range.USE)),
    components: () => readAuthorComponentCatalogueInRange(owner.domainId, componentUse!),
    async usage(id) {
      await readCurrentContentInRange(owner.domainId, "projection", id, range, viewer.locale);
      return graphUsage(id);
    },
    graphUsage,
  });
}

export function createProductProjectionReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, content = projectionCatalogueContent(owner, viewer),
) {
  const rawRecord = content.record;
  const language = resolveLocale(viewer.locale);
  const word = (key: string) => tForLocale(language, `panels.productCatalog.projection.${key}`);

  async function resolveComponentLabels(): Promise<Map<string, string>> {
    try {
      const catalogue = await content.components();
      return new Map([...catalogue].map(([componentId, item]) => [componentId, item.label]));
    } catch {
      return new Map();
    }
  }

  async function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number, chart = false) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined, values.visibility === "platform", values.publicationAccess);
    if (chart) return formResult("projection", id, fields, values, revision);
    const schema = directProjectionPortsSchema.shape;
    if (revision === undefined && values.componentId === METRIC_CHART_COMPONENT) {
      return formResult("projection", id, [
        ...fields,
        field("/componentId", schema.componentId, { kind: "text" }, { labelKey: "component", readOnly: true }),
        field("/data", schema.data, { kind: "code", language: "json" }, { readOnly: true }),
      ], values, revision);
    }
    const components = await content.components();
    const candidates = [...components].filter(([key, item]) => key !== METRIC_CHART_COMPONENT && item.declaration.data !== undefined);
    const component = typeof values.componentId === "string" ? components.get(values.componentId)?.declaration : undefined;
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

  function presentQuery(
    listed: CataloguePage, ownerLabels: ReadonlyMap<string, string>, componentLabels: ReadonlyMap<string, string>,
  ): PanelRecordQuery {
    return {
      rows: listed.items.map(item => toProductProjectionPanelRecord({
        ...item,
        componentId: item.componentId ?? "",
        ...("objectTypes" in item && Array.isArray(item.objectTypes) ? { objectTypes: item.objectTypes } : {}),
      }, viewer.locale, {
        ownerLabel: item.ownerId ? ownerLabels.get(item.ownerId) : undefined,
        componentLabel: item.componentId ? componentLabels.get(item.componentId) : undefined,
      })),
      total: listed.total,
      ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}),
    };
  }

  function presentCreateForm(params: FormParams) {
    const id = draftId(params.values);

    return describeForm(id, {
      name: "", description: "", visibility: "private", publicationAccess: { kind: "domain" }, componentId: "",
      inputs: {}, outputs: {}, config: {}, data: {}, ...params.values, id,
    }, true);
  }

  return {
    async query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
      const listed = await listCurrentProducts(owner, viewer, "projection", projectionCatalogueInput(params));
      const [ownerLabels, componentLabels] = await Promise.all([
        resolveOwnerNames(listed.items.map(item => item.ownerId), viewer),
        resolveComponentLabels(),
      ]);
      return presentQuery(listed, ownerLabels, componentLabels);
    },
    presentQuery,
    async componentOptions(): Promise<PanelRecord[]> {
      const [{ componentIds }, catalogue] = await Promise.all([
        content.facets(),
        content.components().catch(() => new Map()),
      ]);
      const domainPackageLabel = tForLocale(language, "panels.sdkComponent.domain");
      const packageFieldLabel = tForLocale(language, "panels.sdkComponent.package");
      return componentIds
        .map((componentId): PanelRecord => {
          const entry = catalogue.get(componentId);
          const label = entry?.label || shortComponentName(componentId);
          const packageLabel = entry?.packageName
            ?? (componentId.includes(":") && !componentId.startsWith("domain-component:")
              ? componentId.slice(0, componentId.lastIndexOf(":"))
              : domainPackageLabel);
          return {
            primaryKey: componentId,
            className: SDK_COMPONENT,
            label,
            ...(label !== componentId && { subtitle: componentId }),
            fields: { componentId, package: packageLabel },
            fieldLabels: { componentId: word("component"), package: packageFieldLabel },
          };
        })
        .sort((left, right) =>
          String(left.fields.package ?? "").localeCompare(String(right.fields.package ?? ""))
          || left.label.localeCompare(right.label),
        );
    },
    async objectTypeOptions(): Promise<PanelRecord[]> {
      const { objectTypes } = await content.facets();
      const layerOrder = new Map<string, number>(platformOntologyLayers.map((layer, index) => [layer, index]));
      const customGroupLabel = word("objectTypeGroupCustom");
      return objectTypes
        .map((typeId) => {
          const entry = Object.hasOwn(platformObjectTypes, typeId) ? platformObjectTypes[typeId] : undefined;
          const label = resolveObjectTypeLabel(typeId, language) ?? typeId;
          const layer = entry?.layer;
          const groupLabel = layer ? tForLocale(language, `platformOntology.layers.${layer}`) : customGroupLabel;
          const rank = layer ? (layerOrder.get(layer) ?? platformOntologyLayers.length) : -1;
          return {
            rank,
            record: {
              primaryKey: typeId,
              className: ONTOLOGY_TYPE,
              label,
              ...(label !== typeId && { subtitle: typeId }),
              fields: { typeId, group: groupLabel },
              fieldLabels: { typeId: word("objectType"), group: word("objectType") },
            } satisfies PanelRecord,
          };
        })
        .sort((left, right) => left.rank - right.rank || left.record.label.localeCompare(right.record.label))
        .map(item => item.record);
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      const projection = await rawRecord(primaryKey);
      const [ownerLabels, componentLabels, domainShared, usage] = await Promise.all([
        resolveOwnerNames([projection.ownerId], viewer),
        resolveComponentLabels(),
        projection.editable
          ? catalogueGrants(owner, viewer, "projection", primaryKey).then(result => result.shared)
          : false,
        currentProjectionUsedBy(owner, viewer, primaryKey).catch(() => ({ panels: [], hiddenCount: 0 })),
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
      return currentProjectionUsedBy(owner, viewer, primaryKey);
    },
    async usedByRows(primaryKey: string): Promise<PanelRecord[]> {
      const usage = await content.usage(primaryKey);
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
    async referenceGraph(primaryKey: string): Promise<PanelRecord> {
      const projection = await rawRecord(primaryKey);
      const usage = await content.graphUsage(primaryKey);
      const graph = createAssetGraph();
      const center = assetGraphNode("projection", projection);
      graph.addNode(center);
      addProjectionGraphReferences(graph, projection, id => resolveObjectTypeLabel(id, language) ?? id);
      for (const panel of usage.panels) {
        const node = assetGraphNode("panel", { id: panel.id, name: panel.name });
        graph.addNode(node);
        graph.addEdge(node.id, center.id, "contains");
      }
      return toReferenceGraphRecord(projection.id, PRODUCT_PROJECTION, projection.name || projection.id, graph.build());
    },
    grants(primaryKey: string) {
      return catalogueGrants(owner, viewer, "projection", primaryKey);
    },
    grantRows(primaryKey: string) {
      return policyGrantRows(owner, viewer, "projection", primaryKey, word);
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
      const chart = componentId === METRIC_CHART_COMPONENT && projection.visibility !== "platform";
      const values = chart ? { ...commonValues(projection), componentId } : {
        ...commonValues(projection), componentId, data, config, inputs, outputs,
        ...(operations !== undefined && { operations }), ...(conversationEntry !== undefined && { conversationEntry }),
      };
      return describeForm(primaryKey, { ...values, ...params.values }, projection.editable, projection.revision, chart);
    },
    async createForm(params: FormParams) {
      await requireObject({ create: "PROJECTION" }, viewer);
      return presentCreateForm(params);
    },
    presentCreateForm,
  };
}

const productRecordFactsSchema = z.object({
  editable: z.boolean(),
  shared: z.boolean().optional(),
  ownerLabel: z.string().optional(),
}).strict();

export async function prepareProductCatalogueRead(
  owner: ProductOwner, viewer: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
): Promise<{
  call: JavaPanelRead["call"];
  visibility?: readonly PanelReadVisibility[];
  present(payload: unknown, ranges?: PanelReadRanges): unknown;
} | undefined> {
  const { typeId, method } = selection;
  if (typeId !== PRODUCT_PANEL && typeId !== PRODUCT_PROJECTION) return;
  const kind = typeId === PRODUCT_PANEL ? "panel" : "projection";
  if (method === "createForm") {
    const values = params.values as PanelFormValues | undefined;
    requireFormFieldNames(values, "values");
    return {
      call: { type: typeId, name: method, parameters: {} },
      ...(kind === "projection" && values?.componentId !== METRIC_CHART_COMPONENT && {
        visibility: [{ kind: "COMPONENT", verbs: ["USE"] }] satisfies PanelReadVisibility[],
      }),
      present(payload: unknown, ranges?: PanelReadRanges) {
        z.literal(true).parse(payload);
        return kind === "panel" ? createProductPanelReadAdapter(owner, viewer).presentCreateForm({ values })
          : createProductProjectionReadAdapter(owner, viewer, {
            ...projectionCatalogueContent(owner, viewer),
            components: () => readAuthorComponentCatalogueInRange(owner.domainId, ranges!.COMPONENT.USE),
          }).presentCreateForm({ values });
      },
    };
  }
  if (method === "record") {
    const row = await loadCurrentProduct(owner.domainId, kind, selection.primaryKey!);
    const fixed = row.domainId === null;
    const details = kind === "projection" || !cataloguePanel(row, false).unavailable;
    const visibility: PanelReadVisibility[] = [];
    if (details || (fixed && kind === "panel")) visibility.push({ kind: "PANEL", verbs: ["USE"] });
    if (kind === "projection") {
      visibility.push({ kind: "COMPONENT", verbs: ["USE"] });
      if (fixed) visibility.push({ kind: "PROJECTION", verbs: ["USE"] });
    }
    const { target, ownerFacts } = currentDefinition(kind, row, owner.domainId);
    return {
      call: fixed ? undefined : { type: typeId, name: method, parameters: { target, ownerFacts, details } },
      visibility: visibility.length ? visibility : undefined,
      async present(payload: unknown, ranges?: PanelReadRanges) {
        if (fixed && !ranges![target.kind].USE.fixed) {
          if (kind === "panel") throw new HttpError(403, "Product use Grant required", "PRODUCT_FORBIDDEN");
          throw new HttpError(403, "This platform definition cannot be used.", "OBJECT_FORBIDDEN");
        }
        const facts: z.infer<typeof productRecordFactsSchema> = fixed ? { editable: false } : productRecordFactsSchema.parse(payload);
        if (kind === "panel") {
          const result = cataloguePanel(row, facts.editable);
          const hiddenCount = details ? (await panelsUsingPanelInRange(owner.domainId, row.id, ranges!.PANEL.USE)).hiddenCount : 0;
          return createProductPanelReadAdapter(owner, viewer).presentRecord(result, facts.ownerLabel, facts.shared, hiddenCount);
        }
        const projection = projectionDefinition(row, facts.editable);
        const [components, usage] = await Promise.all([
          readAuthorComponentCatalogueInRange(owner.domainId, ranges!.COMPONENT.USE),
          panelsUsingProjectionInRange(owner.domainId, row.id, ranges!.PANEL.USE),
        ]);
        return toProductProjectionPanelRecord(projection, viewer.locale, {
          ownerLabel: facts.ownerLabel ?? projection.ownerId ?? undefined,
          componentLabel: components.get(projection.componentId)?.label,
          domainShared: facts.shared,
          usedByCount: usage.panels.length + usage.hiddenCount,
          hiddenUsedByCount: usage.hiddenCount,
        });
      },
    };
  }
  if (method === "grants" || method === "grantRows") {
    const { target, ownerFacts } = await catalogueObject(owner, kind, selection.primaryKey!);
    return {
      call: { type: typeId, name: "grantRows", parameters: { target, ownerFacts } },
      present(payload: unknown) {
        const access = productObjectAccessSchema.parse(payload);
        if (method === "grants") return access;
        const prefix = kind === "panel" ? "application" : "projection";
        return presentPolicyGrantRows(access, kind,
          key => tForLocale(viewer.locale, "panels.productCatalog." + prefix + "." + key));
      },
    };
  }
}

function memberDirectoryCall(parameters: PrincipalDirectoryRequest): NonNullable<JavaPanelRead["call"]> {
  return { type: USER, name: "principalDirectory", parameters };
}

function requireReadyCatalogueFact(result: JavaPanelReadResult) {
  if (result.status === "ready") return result;
  if (result.status === "forbidden") throw new HttpError(403, result.error, result.code ?? undefined);
  if (result.status === "error") throw new HttpError(502, result.error, result.code ?? undefined);
  throw new HttpError(502, "The catalogue owner did not return the requested facts", "PANEL_READ_OWNER_RESPONSE_INVALID");
}

export async function prepareProductCatalogueQuery(
  owner: ProductOwner, viewer: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
): Promise<PreparedOwnerReadFacts | undefined> {
  if (selection.method !== "query" || (selection.typeId !== PRODUCT_PANEL && selection.typeId !== PRODUCT_PROJECTION)) return;
  const panel = selection.typeId === PRODUCT_PANEL;
  const kind = panel ? "panel" : "projection";
  const input = panel ? panelCatalogueInput(params) : projectionCatalogueInput(params);
  const includeAuthorSearch = panel && input.q.length > 0;
  const ids = await catalogueAuthorCandidates(owner, kind, input, includeAuthorSearch);
  return {
    facts: [{
      visibleKinds: panel ? [{ kind: "PANEL", verbs: ["USE", "EDIT"] }]
        : [{ kind: "PROJECTION", verbs: ["USE", "EDIT"] }, { kind: "COMPONENT", verbs: ["USE"] }],
      ...(ids.length && { call: memberDirectoryCall({ kind: "member", ids }) }),
    }, ...(includeAuthorSearch ? [{ call: memberDirectoryCall({ kind: "member", keyword: input.q, limit: 100 }) }] : [])],
    async present(subject, [directoryFact, searchFact]) {
      const directory = requireReadyCatalogueFact(directoryFact);
      const names = ids.length ? principalDirectoryResponseSchema.parse(directory.payload).options : [];
      const matchingAuthors = includeAuthorSearch
        ? principalDirectoryResponseSchema.parse(requireReadyCatalogueFact(searchFact).payload).options.map(({ id }) => id)
        : undefined;
      const { USE, EDIT } = directory.visibility![panel ? "PANEL" : "PROJECTION"];
      const listed = await listCurrentProductsInRanges(subject, kind, input, { USE, EDIT }, matchingAuthors);
      const byId = new Map(names.map(({ id, name }) => [id, name]));
      const pageNames = new Map(listed.items.flatMap(({ ownerId }) => ownerId === null ? [] : [[ownerId, byId.get(ownerId) ?? ownerId] as const]));
      if (panel) return createProductPanelReadAdapter(subject, viewer).presentQuery(listed, pageNames);
      const components = await readAuthorComponentCatalogueInRange(subject.domainId, directory.visibility!.COMPONENT.USE);
      const componentLabels = new Map([...components].map(([id, entry]) => [id, entry.label]));
      return createProductProjectionReadAdapter(subject, viewer).presentQuery(listed, pageNames, componentLabels);
    },
  };
}

const registeredPanelUse = [{ kind: "PANEL", verbs: ["USE"] }] as const;
const registeredPanelEdit = [{ kind: "PANEL", verbs: ["USE", "EDIT"] }] as const;
const registeredProjectionUse = [{ kind: "PROJECTION", verbs: ["USE"] }] as const;
const registeredProjectionEdit = [{ kind: "PROJECTION", verbs: ["USE", "EDIT"] }] as const;
const registeredComponentUse = [{ kind: "COMPONENT", verbs: ["USE"] }] as const;

function panelCatalogueRegisteredRead(
  visibility: readonly PanelReadVisibility[],
  read: (reads: ReturnType<typeof createScopedProductPanelReads>, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
  readJavaFacts?: true,
): RegisteredLocalDataRead {
  return {
    visibility,
    readJavaFacts,
    read(owner, ranges, facts, credentials, primaryKey, params) {
      const { USE, EDIT } = ranges!.PANEL;
      return read(createScopedProductPanelReads(owner, credentials, { USE, EDIT }, ranges!.PROJECTION?.USE, facts), primaryKey!, params);
    },
  };
}

function projectionCatalogueRegisteredRead(
  visibility: readonly PanelReadVisibility[],
  read: (reads: ReturnType<typeof createScopedProductProjectionReads>, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalDataRead {
  return {
    visibility,
    read(owner, ranges, _facts, credentials, primaryKey, params) {
      const { USE, EDIT } = ranges!.PROJECTION;
      const reads = createScopedProductProjectionReads(owner, credentials, { USE, EDIT }, ranges!.COMPONENT?.USE, ranges!.PANEL?.USE);
      return read(reads, primaryKey!, params);
    },
  };
}

function registeredCatalogueFormValues(params: Record<string, unknown>) {
  requireFormFieldNames(params.values, "values");
  return { values: params.values as PanelFormValues | undefined };
}

export const productCatalogueDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["createForm", "record", "grants", "grantRows"] as const).flatMap(method => [
    ownerReadRegistration(PRODUCT_PANEL, method, ({ owner, credentials, selection, params }) =>
      prepareProductCatalogueRead(owner, credentials, selection, params)),
    ownerReadRegistration(PRODUCT_PROJECTION, method, ({ owner, credentials, selection, params }) =>
      prepareProductCatalogueRead(owner, credentials, selection, params)),
  ]),
  ...([PRODUCT_PANEL, PRODUCT_PROJECTION] as const).map(typeId =>
    ownerFactsRegistration(typeId, "query", ({ owner, credentials, selection, params }) =>
      prepareProductCatalogueQuery(owner, credentials, selection, params))),
  localReadRegistration(PRODUCT_PANEL, "options", {
    visibility: registeredPanelUse,
    read: (owner, ranges, _facts, _credentials, _key, params) => readScopedPanelPickerOptions(
      owner, ranges!.PANEL.USE, params.keyword as string | undefined, params.page as Parameters<typeof readScopedPanelPickerOptions>[3],
    ),
  }),
  localReadRegistration(PRODUCT_PANEL, "unavailable", panelCatalogueRegisteredRead(registeredPanelEdit, reads => reads.unavailable())),
  localReadRegistration(PRODUCT_PANEL, "members", panelCatalogueRegisteredRead([...registeredPanelEdit, ...registeredProjectionUse], (reads, key) => reads.members(key))),
  localReadRegistration(PRODUCT_PANEL, "memberRows", panelCatalogueRegisteredRead([...registeredPanelEdit, ...registeredProjectionUse], (reads, key) => reads.memberRows(key))),
  localReadRegistration(PRODUCT_PANEL, "usedBy", panelCatalogueRegisteredRead(registeredPanelEdit, (reads, key) => reads.usedBy(key), true),
    ({ selection }) => ({ type: PRODUCT_PANEL, name: "usedByRows", parameters: { primaryKey: selection.primaryKey! } })),
  localReadRegistration(PRODUCT_PANEL, "usedByRows", panelCatalogueRegisteredRead(registeredPanelEdit, (reads, key) => reads.usedByRows(key), true)),
  localReadRegistration(PRODUCT_PANEL, "referenceGraph", panelCatalogueRegisteredRead([...registeredPanelEdit, ...registeredProjectionUse], (reads, key) => reads.referenceGraph(key), true)),
  localReadRegistration(PRODUCT_PANEL, "sourceFiles", panelCatalogueRegisteredRead(registeredPanelUse, (reads, key) => reads.sourceFiles(key))),
  localReadRegistration(PRODUCT_PANEL, "sourceFile", panelCatalogueRegisteredRead(registeredPanelUse, (reads, key, params) =>
    reads.sourceFile(key, panelReadParameterSchemas.skillFilePath.parse(params.path)))),
  localReadRegistration(PRODUCT_PANEL, "form", panelCatalogueRegisteredRead(registeredPanelEdit, (reads, key, params) =>
    reads.form(key, registeredCatalogueFormValues(params)))),
  localReadRegistration(PRODUCT_PANEL, "homePanel", {
    visibility: registeredPanelUse,
    read(owner, ranges, _facts, credentials) {
      const range = ranges?.PANEL?.USE;
      if (!range) throw new HttpError(502, "The panel read owner did not provide PANEL/USE visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
      return readRegisteredHomePanel(owner, credentials.locale, range);
    },
  }),
  localReadRegistration(PRODUCT_PROJECTION, "componentOptions", projectionCatalogueRegisteredRead([...registeredProjectionUse, ...registeredComponentUse], reads => reads.componentOptions())),
  localReadRegistration(PRODUCT_PROJECTION, "objectTypeOptions", projectionCatalogueRegisteredRead(registeredProjectionUse, reads => reads.objectTypeOptions())),
  localReadRegistration(PRODUCT_PROJECTION, "dataRows", projectionCatalogueRegisteredRead(registeredProjectionUse, (reads, key) => reads.dataRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "configRows", projectionCatalogueRegisteredRead(registeredProjectionUse, (reads, key) => reads.configRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "inputRows", projectionCatalogueRegisteredRead(registeredProjectionUse, (reads, key) => reads.inputRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "outputRows", projectionCatalogueRegisteredRead(registeredProjectionUse, (reads, key) => reads.outputRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "operationRows", projectionCatalogueRegisteredRead(registeredProjectionUse, (reads, key) => reads.operationRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "usedBy", projectionCatalogueRegisteredRead([...registeredProjectionUse, ...registeredPanelUse], (reads, key) => reads.usedBy(key))),
  localReadRegistration(PRODUCT_PROJECTION, "usedByRows", projectionCatalogueRegisteredRead([...registeredProjectionUse, ...registeredPanelUse], (reads, key) => reads.usedByRows(key))),
  localReadRegistration(PRODUCT_PROJECTION, "referenceGraph", projectionCatalogueRegisteredRead([...registeredProjectionUse, ...registeredPanelUse], (reads, key) => reads.referenceGraph(key))),
  localReadRegistration(PRODUCT_PROJECTION, "form", projectionCatalogueRegisteredRead([...registeredProjectionEdit, ...registeredComponentUse], (reads, key, params) =>
    reads.form(key, registeredCatalogueFormValues(params)))),
];
