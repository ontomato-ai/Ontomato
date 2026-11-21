import { appsSdkComponentCatalogSchema, appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import { directReadDeclaration, type PanelRecord } from "@ontomato/contracts/panel-projection";
import type { BuiltinProductProjectionInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { readCurrentAppSdkComponents } from "../app-builder/sdk";

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

export async function listSdkComponents(locale: string | undefined, search?: string): Promise<PanelRecord[]> {
  const { components } = await readPanelComponentCatalogue();
  const term = search?.trim().toLowerCase();
  const fieldLabels = {
    package: tForLocale(locale, "panels.sdkComponent.package"),
    meaning: tForLocale(locale, "panels.sdkComponent.meaning"),
  };
  return [...components].flatMap(([primaryKey, { componentId, module, meaning, effects }]) => {
    if (term && ![primaryKey, module, meaning, effects].some(text => text?.toLowerCase().includes(term))) return [];
    return [{
      primaryKey, label: componentId,
      fields: { package: primaryKey.slice(0, primaryKey.lastIndexOf(":")), meaning }, fieldLabels,
    }];
  });
}

export async function readSdkComponent(componentId: string, locale: string | undefined) {
  const { components } = await readPanelComponentCatalogue();
  const component = components.get(componentId);
  if (!component) throw new HttpError(404, tForLocale(locale, "panels.sdkComponent.notFound", { componentId }), "SDK_COMPONENT_NOT_FOUND");
  return component;
}

export async function validateProjectionComponent(id: string, projection: ProductProjectionInput | BuiltinProductProjectionInput,
  readCatalogue = readPanelComponentCatalogue) {
  const { components } = await readCatalogue();
  const component = components.get(projection.componentId);
  if (!component)
    throw new HttpError(400, `Projection '${id}', componentId '${projection.componentId}' is absent from the current SDK`, "PANEL_COMPONENT_UNAVAILABLE");
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
    const { results } = declaration;
    if (!results.includes(result))
      throw new HttpError(400, `Projection '${id}', field 'data.${name}' returns '${result}'; component '${projection.componentId}' accepts ${results.join(", ")}`, "PANEL_COMPONENT_DATA_RESULT_MISMATCH");
  }
}
