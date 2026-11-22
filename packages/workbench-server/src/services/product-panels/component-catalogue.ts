import type { ProductOwner } from "../product-governance/grants";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { domainComponentForProjection, domainComponentRecord, listVisibleDomainComponents } from "../domain-components/store";
import { appsSdkComponentCatalogSchema, appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import { directReadDeclaration, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { panelReadResultIdSchema } from "@ontomato/contracts/panel-operations";
import type { BuiltinProductProjectionInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { readCurrentAppSdkComponents } from "../app-builder/sdk";
import { listComponentPackages, readComponentPackage } from "../component-packages/store";

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
  const definitions = new Map<string, { declaration: ComponentDeclaration; label: string; packageName?: string }>();
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

export async function listSdkComponents(owner: ProductOwner, locale: string | undefined, search?: string): Promise<PanelRecord[]> {
  const components = await readAuthorComponentCatalogue(owner);
  const term = search?.trim().toLowerCase();
  const fieldLabels = {
    package: tForLocale(locale, "panels.sdkComponent.package"),
    meaning: tForLocale(locale, "panels.sdkComponent.meaning"),
  };
  return [...components].flatMap(([primaryKey, { label, declaration: { meaning, effects }, packageName }]) => {
    if (term && ![primaryKey, label, packageName, meaning, effects].some(text => text?.toLowerCase().includes(term))) return [];
    return [{
      primaryKey, label,
      fields: { package: packageName ?? tForLocale(locale, "panels.sdkComponent.domain"), meaning }, fieldLabels,
    }];
  });
}

export async function readSdkComponent(owner: ProductOwner, componentId: string, locale: string | undefined) {
  const definition = (await readAuthorComponentCatalogue(owner)).get(componentId);
  if (!definition) throw new HttpError(404, tForLocale(locale, "panels.sdkComponent.notFound", { componentId }), "SDK_COMPONENT_NOT_FOUND");
  return definition.declaration;
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
  const official = components.get(componentId);
  if (official) return official;
  const separator = componentId.lastIndexOf(":");
  if (separator < 1) return undefined;
  const release = await readComponentPackage(componentId.slice(0, separator));
  return release?.components.find(component => component.componentId === componentId);
}

export async function validateProjectionComponent(
  id: string, projection: ProductProjectionInput | BuiltinProductProjectionInput, readCatalogue = readPanelComponentCatalogue,
  scope?: { domainId: string | null; authorId?: string; client?: Pick<PoolClient, "query"> },
): Promise<DomainComponentRuntime | undefined> {
  let runtime: DomainComponentRuntime | undefined;
  let component;
  const { componentId } = projection;
  if (isDomainComponentId(componentId)) {
    const row = await domainComponentForProjection(scope?.domainId ?? null, componentId, scope?.client);
    if (row) {
      const record = domainComponentRecord(row, false);
      if (scope?.authorId === undefined || record.ownerId === scope.authorId || record.visibility === "domain") {
        component = record.declaration;
        runtime = { componentId, domainId: record.domainId, revision: record.revision, source: record.source };
      }
    }
  } else {
    component = await readProjectionComponent(componentId, readCatalogue);
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
  return runtime;
}
