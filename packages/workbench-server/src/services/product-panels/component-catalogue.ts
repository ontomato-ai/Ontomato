import type { ProductOwner } from "../product-governance/grants";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { domainComponentForProjection, domainComponentRecord, listVisibleDomainComponents } from "../domain-components/store";
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
import { runtimeRoot } from "../../content/layout";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { readCurrentAppSdkComponents } from "../app-builder/sdk";
import { listComponentPackages, readComponentPackage } from "../component-packages/store";

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

export async function readPanelComponentCatalogue() {
  const { version, digest, catalogue: raw } = await readCurrentAppSdkComponents();
  const catalogue = appsSdkComponentCatalogSchema.parse(raw);
  if (catalogue.version !== version) throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  const components = new Map(catalogue.components.map(component => {
    const packageName = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
    return [`${packageName}:${component.componentId}`, component];
  }));
  return { version, digest, components };
}

export async function readAuthorComponentCatalogue(owner: ProductOwner) {
  const [{ components }, deployed, registered] = await Promise.all([
    readPanelComponentCatalogue(), listComponentPackages(), listVisibleDomainComponents(owner.domainId, owner.userId),
  ]);
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
  for (const { declaration, name } of registered) definitions.set(declaration.componentId, { declaration, label: name });
  return definitions;
}

async function requireSdkComponentEntry(
  owner: ProductOwner,
  componentId: string,
  locale: string | undefined,
): Promise<AuthorComponentEntry> {
  const entry = (await readAuthorComponentCatalogue(owner)).get(componentId);
  if (!entry) throw new HttpError(404, tForLocale(locale, "panels.sdkComponent.notFound", { componentId }), "SDK_COMPONENT_NOT_FOUND");
  return entry;
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

export async function countSdkComponents(owner: ProductOwner) {
  return { rows: [], total: (await readAuthorComponentCatalogue(owner)).size };
}

export async function listSdkComponents(
  owner: ProductOwner,
  locale: string | undefined,
  search?: string,
): Promise<PanelRecord[]> {
  const components = await readAuthorComponentCatalogue(owner);
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
        ...(bindsElement?.length ? { tags: { bindsElement: [...bindsElement] } } : {}),
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

export async function readSdkComponent(owner: ProductOwner, componentId: string, locale: string | undefined) {
  return (await requireSdkComponentEntry(owner, componentId, locale)).declaration;
}

export async function readSdkComponentRecord(
  owner: ProductOwner,
  componentId: string,
  locale: string | undefined,
): Promise<PanelRecord> {
  const entry = await requireSdkComponentEntry(owner, componentId, locale);
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
  locale: string | undefined,
): Promise<PanelRecord[]> {
  const { declaration } = await requireSdkComponentEntry(owner, componentId, locale);
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
  locale: string | undefined,
): Promise<PanelRecord[]> {
  const { declaration } = await requireSdkComponentEntry(owner, componentId, locale);
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
  locale: string | undefined,
): Promise<PanelRecord[]> {
  const { declaration } = await requireSdkComponentEntry(owner, componentId, locale);
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
  locale: string | undefined,
): Promise<PanelRecord[]> {
  const { declaration } = await requireSdkComponentEntry(owner, componentId, locale);
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
  locale: string | undefined,
): Promise<PanelRecord[]> {
  const { declaration } = await requireSdkComponentEntry(owner, componentId, locale);
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
  domainId: string | null = null, client?: Pick<PoolClient, "query">,
) {
  if (isDomainComponentId(componentId)) {
    const row = await domainComponentForProjection(domainId, componentId, client);
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

/**
 * Resolve all author-registered components declared in a panel's `manifest.components` for rendering or validation.
 * When `authorId` is provided (saving a panel), enforces author visibility (`ownerId === authorId || visibility === "domain"`).
 */
export async function readPanelDomainComponents(
  domainId: string | null,
  components: Readonly<Record<string, string>> | undefined,
  options?: { authorId?: string; client?: Pick<PoolClient, "query">; strict?: boolean },
): Promise<Record<string, DomainComponentRuntime> | undefined> {
  const uniqueIds = [...new Set(Object.values(components ?? {}))];
  if (!uniqueIds.length) return undefined;
  const resolved: Record<string, DomainComponentRuntime> = {};
  await Promise.all(uniqueIds.map(async (componentId) => {
    const row = await domainComponentForProjection(domainId, componentId, options?.client);
    if (row) {
      const record = domainComponentRecord(row, false);
      if (options?.authorId === undefined || record.ownerId === options.authorId || record.visibility === "domain") {
        resolved[componentId] = { componentId, domainId: record.domainId, revision: record.revision, source: record.source };
        return;
      }
    }
    if (options?.strict) {
      throw new HttpError(400, `Panel component '${componentId}' is unavailable in this domain`, "PANEL_COMPONENT_UNAVAILABLE");
    }
  }));
  return Object.keys(resolved).length ? resolved : undefined;
}

let renderCatalogue: { root: string; pending: ReturnType<typeof readPanelComponentCatalogue> } | undefined;

async function shippedRenderCatalogue() {
  const root = runtimeRoot();
  if (renderCatalogue?.root === root) return renderCatalogue.pending;
  // The SDK bundled with this process is immutable for the life of the deployed release.
  const load = { root, pending: readPanelComponentCatalogue() };
  renderCatalogue = load;
  try {
    return await load.pending;
  } catch (error) {
    if (renderCatalogue === load) renderCatalogue = undefined;
    throw error;
  }
}

const renderValidation = new WeakMap<object, { dependency: string; runtime: DomainComponentRuntime | undefined }>();

export async function validateProjectionComponent(
  id: string, projection: ProductProjectionInput | BuiltinProductProjectionInput, readCatalogue = readPanelComponentCatalogue,
  scope?: { domainId: string | null; authorId?: string; client?: Pick<PoolClient, "query"> },
): Promise<DomainComponentRuntime | undefined> {
  const rendering = "revision" in projection && scope?.authorId === undefined &&
    scope?.client === undefined && readCatalogue === readPanelComponentCatalogue;
  let runtime: DomainComponentRuntime | undefined;
  let component;
  let dependency: string | undefined;
  const { componentId } = projection;
  if (isDomainComponentId(componentId)) {
    const row = await domainComponentForProjection(scope?.domainId ?? null, componentId, scope?.client);
    if (row) {
      dependency = JSON.stringify([row.domainId, componentId, row.revision, row.createdAt, row.updatedAt]);
      const cached = rendering ? renderValidation.get(projection.data) : undefined;
      if (cached?.dependency === dependency) return cached.runtime;
      const record = domainComponentRecord(row, false);
      if (scope?.authorId === undefined || record.ownerId === scope.authorId || record.visibility === "domain") {
        component = record.declaration;
        runtime = { componentId, domainId: record.domainId, revision: record.revision, source: record.source };
      }
    }
  } else {
    const catalogue = await (rendering ? shippedRenderCatalogue() : readCatalogue());
    component = catalogue.components.get(componentId);
    if (component) dependency = catalogue.digest;
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
