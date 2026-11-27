import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import type { CurrentProductRow } from "../../infrastructure/product-current";
import {
  countDomainComponentsInRange, countVisibleDomainComponents, domainComponentForProjection, domainComponentRecord,
  listDomainComponentsInRange, listVisibleDomainComponents,
} from "../domain-components/store";
import {
  APPS_SDK_COMPONENT_GROUPS,
  appsSdkComponentCatalogSchema,
  appsSdkComponentDatum,
  type AppsSdkComponentCatalogEntry,
  type AppsSdkComponentGroup,
} from "@ontomato/contracts/apps-sdk";
import type { DirectPanelPortType } from "@ontomato/contracts/panel-manifest";
import { directReadDeclaration, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { panelReadResultIdSchema } from "@ontomato/contracts/panel-operations";
import { SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import type { BuiltinProductProjectionInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { readCurrentAppSdkComponents } from "../app-builder/sdk";
import { listComponentPackages, readComponentPackage } from "../component-packages/store";
import { requireAllowed } from "../product-governance/authorization";
import { currentDefinitionAccess, definitionVisibleInRange, requireCurrentDefinitionUse, type DefinitionVisibilityRange } from "./access";

export type ComponentScope = {
  domainId: string | null;
  credentials: AssistantCredentials;
  client?: Pick<PoolClient, "query">;
  componentUsable?: (row: CurrentProductRow) => boolean | undefined;
};

type AuthorComponentDeclaration = ComponentDeclaration & Partial<Pick<AppsSdkComponentCatalogEntry, "module" | "exportName" | "group" | "panelUsable">>;
type AuthorComponentEntry = { declaration: AuthorComponentDeclaration; label: string; packageName?: string };

const SDK_COMPONENT_GROUP_ORDER = new Map<AppsSdkComponentGroup, number>(
  APPS_SDK_COMPONENT_GROUPS.map((group, index) => [group, index]),
);

function sdkComponentGroupLabel(group: AppsSdkComponentGroup | undefined, locale: string | undefined): string | undefined {
  return group ? tForLocale(locale, `panels.sdkComponent.group.${group}`) : undefined;
}

function sdkComponentRoleLabel(role: ComponentDeclaration["role"], locale: string | undefined): string {
  return role === "presentation"
    ? tForLocale(locale, "panels.sdkComponent.rolePresentation")
    : role === "control"
      ? tForLocale(locale, "panels.sdkComponent.roleControl")
      : role;
}

function sdkComponentPanelUsableLabel(panelUsable: boolean, locale: string | undefined): string {
  return tForLocale(locale, panelUsable ? "panels.sdkComponent.panelUsableYes" : "panels.sdkComponent.panelUsableShellOnly");
}

function sdkComponentGroupRank(group: AppsSdkComponentGroup | undefined): number {
  return group ? (SDK_COMPONENT_GROUP_ORDER.get(group) ?? APPS_SDK_COMPONENT_GROUPS.length) : APPS_SDK_COMPONENT_GROUPS.length;
}

type PanelComponentCatalogue = { version: string; digest: string; components: Map<string, AppsSdkComponentCatalogEntry> };
let loadedCatalogue: { raw: unknown; catalogue: PanelComponentCatalogue } | undefined;

export async function readPanelComponentCatalogue(): Promise<PanelComponentCatalogue> {
  const { version, digest, catalogue: raw } = await readCurrentAppSdkComponents();
  if (loadedCatalogue && loadedCatalogue.raw === raw &&
      loadedCatalogue.catalogue.version === version && loadedCatalogue.catalogue.digest === digest)
    return loadedCatalogue.catalogue;
  const catalogue = appsSdkComponentCatalogSchema.parse(raw);
  if (catalogue.version !== version) throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  const components = new Map(catalogue.components.map(component => {
    const packageName = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
    return [`${packageName}:${component.componentId}`, component];
  }));
  const parsed = { version, digest, components };
  loadedCatalogue = { raw, catalogue: parsed };
  return parsed;
}

async function readReleasedAuthorComponents() {
  const [{ components }, deployed] = await Promise.all([readPanelComponentCatalogue(), listComponentPackages()]);
  const definitions = new Map<string, AuthorComponentEntry>();
  for (const [componentId, declaration] of components) {
    definitions.set(componentId, {
      declaration, label: declaration.componentId, packageName: componentId.slice(0, componentId.lastIndexOf(":")),
    });
  }
  for (const release of deployed) {
    for (const declaration of release.components) {
      if (definitions.has(declaration.componentId)) continue;
      definitions.set(declaration.componentId, { declaration, label: declaration.componentId, packageName: release.name });
    }
  }
  return definitions;
}

export function readAuthorComponentCatalogue(owner: ProductOwner, viewer: AssistantCredentials, range?: DefinitionVisibilityRange) {
  return range ? readAuthorComponentCatalogueInRange(owner.domainId, range)
    : collectAuthorComponents(listVisibleDomainComponents(owner.domainId, viewer, false));
}

export function readAuthorComponentCatalogueInRange(domainId: string, range: DefinitionVisibilityRange) {
  return collectAuthorComponents(listDomainComponentsInRange(domainId, range));
}

async function collectAuthorComponents(domainComponents: ReturnType<typeof listDomainComponentsInRange>) {
  const [definitions, registered] = await Promise.all([readReleasedAuthorComponents(), domainComponents]);
  for (const { declaration, name } of registered) definitions.set(declaration.componentId, { declaration, label: name });
  return definitions;
}

async function requireSdkComponentEntry(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<AuthorComponentEntry> {
  if (isDomainComponentId(componentId)) {
    const row = await requireScopedDomainComponent(componentId, {
      domainId: owner.domainId,
      credentials: viewer,
      ...(range && { componentUsable: (row: CurrentProductRow) => definitionVisibleInRange(row, range, owner.domainId) }),
    });
    if (row) {
      const { declaration, name } = domainComponentRecord(row, false);
      return { declaration, label: name };
    }
  } else {
    const entry = (await readReleasedAuthorComponents()).get(componentId);
    if (entry) return entry;
  }
  throw new HttpError(404, tForLocale(viewer.locale, "panels.sdkComponent.notFound", { componentId }), "SDK_COMPONENT_NOT_FOUND");
}

function formatSdkPortType(
  type: DirectPanelPortType,
  locale: string | undefined,
  componentId?: string,
  name?: string,
): string {
  const word = (key: string, params?: Record<string, unknown>) => tForLocale(locale, `panels.sdkComponent.${key}`, params);
  if (componentId === "@ontomato/sdk:ObjectRelations" && name === "visibleRelationKinds") return word("portRelationKinds");
  switch (type.kind) {
    case "object":
      if (type.objectType === "@any") return word("portAnyOntologyObject");
      return type.objectType === "@binding"
        ? word("portBinding")
        : word("portObject", { type: type.objectType });
    case "scalar":
      return word("portScalar", { type: type.type });
    case "object-union": {
      const parts = [
        "objectTypes" in type && Array.isArray(type.objectTypes) ? type.objectTypes.join(" / ") : "",
        "layers" in type && Array.isArray(type.layers) ? type.layers.join(" + ") : "",
      ].filter(Boolean);
      return word("portUnion", { parts: parts.join(" · ") });
    }
    case "child-object":
      return word("portChildObject", { parent: type.parentType, collection: type.collection });
    case "list":
      return word("portList", { items: formatSdkPortType(type.items, locale) });
    case "placement":
      return word("portPlacement");
    case "grid-layout": {
      const details = [
        type.columns !== undefined ? `columns<=${type.columns}` : "",
        type.maxRowSpan !== undefined ? `maxRowSpan<=${type.maxRowSpan}` : "",
        type.groupIds ? `groups=[${type.groupIds.join(", ")}]` : "",
        type.itemIds ? `items=[${type.itemIds.join(", ")}]` : "",
      ].filter(Boolean);
      const base = word("portGridLayout");
      return details.length ? `${base} (${details.join("; ")})` : base;
    }
    case "json":
      return word("portJson");
  }
}

const MAX_CATALOGUE_BINDS_ELEMENT = 3;

function summarizeBindsElement(bindsElement: readonly string[] | undefined): string[] | undefined {
  if (!bindsElement?.length) return undefined;
  if (bindsElement.length <= MAX_CATALOGUE_BINDS_ELEMENT) return [...bindsElement];
  return [
    ...bindsElement.slice(0, MAX_CATALOGUE_BINDS_ELEMENT),
    `+${bindsElement.length - MAX_CATALOGUE_BINDS_ELEMENT}`,
  ];
}

export async function countSdkComponents(owner: ProductOwner, viewer: AssistantCredentials) {
  const [released, domainCount] = await Promise.all([
    readReleasedAuthorComponents(), countVisibleDomainComponents(owner.domainId, viewer),
  ]);
  return { rows: [], total: released.size + domainCount };
}

export async function countSdkComponentsInRange(domainId: string, range: DefinitionVisibilityRange) {
  const [released, domainCount] = await Promise.all([
    readReleasedAuthorComponents(), countDomainComponentsInRange(domainId, range),
  ]);
  return { rows: [], total: released.size + domainCount };
}

export async function listSdkComponents(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  search?: string,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const components = await readAuthorComponentCatalogue(owner, viewer, range);
  const term = search?.trim().toLowerCase();
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    package: word("package"),
    role: word("role"),
    panelUsable: word("panelUsable"),
    group: word("group"),
    bindsElement: word("bindsElement"),
  };
  const matched: Array<{ rank: number; record: PanelRecord }> = [];
  for (const [primaryKey, { label, declaration, packageName }] of components) {
    const { role, group, bindsElement, meaning, effects } = declaration;
    const panelUsable = declaration.panelUsable !== false;
    const packageLabel = packageName ?? word("domain");
    const roleLabel = sdkComponentRoleLabel(role, locale);
    const panelUsableLabel = sdkComponentPanelUsableLabel(panelUsable, locale);
    const groupLabel = sdkComponentGroupLabel(group, locale);
    if (
      term
      && ![
        primaryKey,
        label,
        packageLabel,
        role,
        roleLabel,
        panelUsableLabel,
        group,
        groupLabel,
        ...(bindsElement ?? []),
        meaning,
        effects,
      ].some(text => text?.toLowerCase().includes(term))
    ) {
      continue;
    }
    const summarizedBindsElement = summarizeBindsElement(bindsElement);
    matched.push({
      rank: sdkComponentGroupRank(group),
      record: {
        primaryKey,
        label,
        fields: {
          package: packageLabel,
          role: roleLabel,
          panelUsable: panelUsableLabel,
          ...(groupLabel && { group: groupLabel }),
        },
        ...(summarizedBindsElement ? { tags: { bindsElement: summarizedBindsElement } } : {}),
        tones: {
          role: role === "control" ? "info" : "default",
          panelUsable: panelUsable ? "success" : "default",
        },
        fieldLabels,
      },
    });
  }
  matched.sort((left, right) => left.rank - right.rank);
  return matched.map(({ record }) => record);
}

export async function readSdkComponent(owner: ProductOwner, componentId: string, viewer: AssistantCredentials, range?: DefinitionVisibilityRange) {
  return (await requireSdkComponentEntry(owner, componentId, viewer, range)).declaration;
}

export async function readSdkComponentRecord(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord> {
  const { locale } = viewer;
  const entry = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const { declaration } = entry;
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const packageLabel = entry.packageName ?? word("domain");
  const roleLabel = sdkComponentRoleLabel(declaration.role, locale);
  const panelUsable = declaration.panelUsable !== false;
  const panelUsableLabel = sdkComponentPanelUsableLabel(panelUsable, locale);
  const groupLabel = sdkComponentGroupLabel(declaration.group, locale);
  const fields: PanelRecord["fields"] = {
    componentId: declaration.componentId,
    package: packageLabel,
    ...(declaration.module && { module: declaration.module }),
    ...(declaration.exportName && { exportName: declaration.exportName }),
    role: roleLabel,
    ...(groupLabel && { group: groupLabel }),
    panelUsable: panelUsableLabel,
    meaning: declaration.meaning,
    ...(declaration.effects && { effects: declaration.effects }),
  };
  return {
    primaryKey: componentId,
    className: SDK_COMPONENT,
    label: entry.label,
    subtitle: packageLabel,
    fields,
    ...(declaration.bindsElement?.length ? { tags: { bindsElement: [...declaration.bindsElement] } } : {}),
    tones: {
      role: declaration.role === "control" ? "info" : "default",
      panelUsable: panelUsable ? "success" : "default",
    },
    fieldLabels: {
      componentId: word("componentId"),
      package: word("package"),
      module: word("module"),
      exportName: word("exportName"),
      role: word("role"),
      group: word("group"),
      panelUsable: word("panelUsable"),
      bindsElement: word("bindsElement"),
      meaning: word("meaning"),
      effects: word("effects"),
    },
  };
}

export async function readSdkComponentDataRows(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const { declaration } = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    results: word("results"),
    required: word("required"),
    runtimeParams: word("runtimeParams"),
  };
  return Object.entries(declaration.data ?? {}).map(([name, datum]): PanelRecord => ({
    primaryKey: name,
    label: name === "*" ? `${word("wildcard")} *` : name,
    fields: {
      required: datum.required ? word("yes") : word("no"),
    },
    tags: {
      results: [...datum.results],
      ...(datum.runtimeParams?.length ? { runtimeParams: [...datum.runtimeParams] } : {}),
    },
    tones: {
      required: datum.required ? "warning" : "default",
    },
    fieldLabels,
  }));
}

export async function readSdkComponentConfigRows(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const { declaration } = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    type: word("type"),
    required: word("required"),
    defaultValue: word("default"),
    description: word("description"),
  };
  return (declaration.config ?? []).map((field): PanelRecord => ({
    primaryKey: field.name,
    label: field.name,
    fields: {
      type: field.type,
      required: field.required ? word("yes") : word("no"),
      ...(field.default !== undefined && { defaultValue: field.default }),
      description: field.description,
    },
    tones: {
      required: field.required ? "warning" : "default",
    },
    fieldLabels,
  }));
}

export async function readSdkComponentInputRows(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const { declaration } = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    kind: word("kind"),
    type: word("type"),
    description: word("description"),
  };
  const inputRows = Object.entries(declaration.inputs ?? {}).map(([name, portType]): PanelRecord => ({
    primaryKey: `input:${name}`,
    label: name,
    fields: {
      kind: word("kindInput"),
      type: formatSdkPortType(portType, locale, componentId, name),
      description: word("inputDeclared"),
    },
    tones: { kind: "info" },
    fieldLabels,
  }));
  const slotRows = (declaration.ports?.slots ?? []).map((slot): PanelRecord => ({
    primaryKey: `slot:${slot.name}`,
    label: `#${slot.name}`,
    fields: {
      kind: word("kindSlot"),
      type: slot.type,
      description: slot.description || word("slotDeclared"),
    },
    tones: { kind: "default" },
    fieldLabels,
  }));
  return [...inputRows, ...slotRows];
}

export async function readSdkComponentOutputRows(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const { declaration } = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    kind: word("kind"),
    type: word("type"),
    description: word("description"),
  };
  const outputRows = Object.entries(declaration.outputs ?? {}).map(([name, portType]): PanelRecord => ({
    primaryKey: `output:${name}`,
    label: name,
    fields: {
      kind: word("kindOutput"),
      type: formatSdkPortType(portType, locale, componentId, name),
      description: word("outputDeclared"),
    },
    tones: { kind: "info" },
    fieldLabels,
  }));
  const readOnlyRows = Object.entries(declaration.readOnlyOutputs ?? {}).map(([name, portType]): PanelRecord => ({
    primaryKey: `readOnlyOutput:${name}`,
    label: name,
    fields: {
      kind: word("kindReadOnlyOutput"),
      type: formatSdkPortType(portType, locale),
      description: word("readOnlyOutputDeclared"),
    },
    tones: { kind: "success" },
    fieldLabels,
  }));
  const eventRows = (declaration.ports?.events ?? []).map((event): PanelRecord => ({
    primaryKey: `event:${event.name}`,
    label: event.name,
    fields: {
      kind: word("kindEvent"),
      type: event.type,
      description: event.description,
    },
    tones: { kind: "default" },
    fieldLabels,
  }));
  return [...outputRows, ...readOnlyRows, ...eventRows];
}

export async function readSdkComponentOperationRows(
  owner: ProductOwner,
  componentId: string,
  viewer: AssistantCredentials,
  range?: DefinitionVisibilityRange,
): Promise<PanelRecord[]> {
  const { locale } = viewer;
  const { declaration } = await requireSdkComponentEntry(owner, componentId, viewer, range);
  const word = (key: string) => tForLocale(locale, `panels.sdkComponent.${key}`);
  const fieldLabels = {
    signature: word("signature"),
  };
  const operations = declaration.operations;
  if (!operations) return [];
  return operations.map((operation): PanelRecord => ({
    primaryKey: operation.name,
    label: operation.name,
    fields: {
      signature: operation.handlerRef,
    },
    fieldLabels,
  }));
}

/** Resolve a projection's component from the SDK or the package's enabled release. */
export async function readProjectionComponent(
  componentId: string, readCatalogue = readPanelComponentCatalogue,
  scope?: ComponentScope,
) {
  if (isDomainComponentId(componentId)) {
    const row = await requireScopedDomainComponent(componentId, scope);
    return row && domainComponentRecord(row, false).declaration;
  }
  const { components } = await readCatalogue();
  return components.get(componentId) ?? (await readPackagedProjectionComponent(componentId))?.declaration;
}

async function readPackagedProjectionComponent(componentId: string) {
  const separator = componentId.lastIndexOf(":");
  if (separator < 1) return undefined;
  const release = await readComponentPackage(componentId.slice(0, separator));
  const declaration = release?.components.find(component => component.componentId === componentId);
  if (release && declaration) return { digest: release.digest, declaration };
}

async function requireScopedDomainComponent(componentId: string, scope?: ComponentScope) {
  if (!scope || scope.domainId === null) return undefined;
  const row = await domainComponentForProjection(scope.domainId, componentId, scope.client);
  if (!row) return;
  const usable = scope.componentUsable?.(row);
  if (usable === undefined) {
    await requireCurrentDefinitionUse("component", row, scope.domainId, scope.credentials);
  } else if (!usable) {
    throw new HttpError(403, "The component cannot be used", "OBJECT_FORBIDDEN");
  }
  return row;
}

/** Resolve declared domain components; strict authoring also requires every declaration to resolve. */
export async function readPanelDomainComponents(
  { domainId, credentials, client, componentUsable }: ComponentScope,
  components: Readonly<Record<string, string>> | undefined,
  options?: { strict?: boolean },
): Promise<Record<string, DomainComponentRuntime> | undefined> {
  const ids = [...new Set(Object.values(components ?? {}))];
  if (!ids.length) return undefined;
  const rows = domainId === null ? [] : (await Promise.all(
    ids.map(id => domainComponentForProjection(domainId, id, client)),
  )).filter(row => row !== undefined);
  if (options?.strict) {
    const present = new Set(rows.map(row => row.id));
    const missing = ids.find(id => !present.has(id));
    if (missing !== undefined)
      throw new HttpError(400, `Panel component '${missing}' is unavailable in this domain`, "PANEL_COMPONENT_UNAVAILABLE");
  }
  if (!rows.length || domainId === null) return undefined;
  const decisions = componentUsable ? rows.map(row => componentUsable(row)
    ? { allowed: true as const }
    : { allowed: false as const, reason: "The component cannot be used", code: "OBJECT_FORBIDDEN" })
    : (await currentDefinitionAccess("component", rows, domainId, credentials, false)).decisions;
  const entries = rows.flatMap((row, index) => {
    const decision = decisions[index];
    if (options?.strict) requireAllowed(decision);
    if (!decision.allowed) return [];
    const { domainId, revision, source } = domainComponentRecord(row, false);
    return [[row.id, { componentId: row.id, domainId, revision, source }] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

type RenderDependency = string | ComponentDeclaration;
const renderValidation = new WeakMap<object, { dependency: RenderDependency; runtime: DomainComponentRuntime | undefined }>();

export async function validateProjectionComponent(
  id: string, projection: ProductProjectionInput | BuiltinProductProjectionInput, readCatalogue = readPanelComponentCatalogue,
  scope?: ComponentScope,
): Promise<DomainComponentRuntime | undefined> {
  const rendering = "revision" in projection && scope?.client === undefined && readCatalogue === readPanelComponentCatalogue;
  let runtime: DomainComponentRuntime | undefined;
  let component;
  let dependency: RenderDependency | undefined;
  const { componentId } = projection;
  if (isDomainComponentId(componentId)) {
    const row = await requireScopedDomainComponent(componentId, scope);
    if (row) {
      dependency = JSON.stringify([row.domainId, componentId, row.revision, row.createdAt, row.updatedAt]);
      const cached = rendering ? renderValidation.get(projection.data) : undefined;
      if (cached?.dependency === dependency) return cached.runtime;
      const record = domainComponentRecord(row, false);
      component = record.declaration;
      runtime = { componentId, domainId: record.domainId, revision: record.revision, source: record.source };
    }
  } else {
    const catalogue = await readCatalogue();
    component = catalogue.components.get(componentId);
    if (component) dependency = component;
    else {
      const packaged = await readPackagedProjectionComponent(componentId);
      dependency = packaged?.digest;
      component = packaged?.declaration;
    }
    const cached = rendering ? renderValidation.get(projection.data) : undefined;
    if (cached && cached.dependency === dependency) return cached.runtime;
  }
  if (!component)
    throw new HttpError(400, `Projection '${id}', componentId '${componentId}' is unavailable to this projection`, "PANEL_COMPONENT_UNAVAILABLE");
  const { data } = component;
  if (data === undefined)
    throw new HttpError(400, `Projection '${id}', componentId '${projection.componentId}' does not declare projection data`, "PANEL_COMPONENT_NOT_PROJECTABLE");

  for (const [name, declaration] of Object.entries(data)) {
    if (declaration.required && !Object.hasOwn(projection.data, name))
      throw new HttpError(400, `Projection '${id}', field 'data.${name}' is required by component '${projection.componentId}'`, "PANEL_COMPONENT_DATA_REQUIRED");
  }
  const reads = Object.entries(projection.data);
  for (const [name, read] of reads) {
    const declaration = appsSdkComponentDatum(data, name);
    if (!declaration)
      throw new HttpError(400, `Projection '${id}', field 'data.${name}' is not declared by component '${projection.componentId}'`, "PANEL_COMPONENT_DATA_UNKNOWN");
    const result = directReadDeclaration(projection, read)!.result;
    if (!panelReadResultIdSchema.safeParse(result).success)
      throw new HttpError(400, `Projection '${id}', field 'data.${name}' has no declared result schema`, "PANEL_READ_RESULT_UNDECLARED");
    const { results } = declaration;
    if (!results.includes(result))
      throw new HttpError(400, `Projection '${id}', field 'data.${name}' returns '${result}'; component '${projection.componentId}' accepts ${results.join(", ")}`, "PANEL_COMPONENT_DATA_RESULT_MISMATCH");
  }
  if (rendering && dependency !== undefined) renderValidation.set(projection.data, { dependency, runtime });
  return runtime;
}
