import { productPanelCatalogQuerySchema } from "@ontomato/contracts/product-catalog-query";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import { directProjectionPortsSchema, type PanelFormDescription, type PanelFormField } from "@ontomato/contracts/panel-projection";
import {
  METRIC_CHART_COMPONENT, productCatalogQuerySchema,
  productPanelInputSchema, productVisibilitySchema, registerProductPanelRequestSchema, type ProductVisibility,
  registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
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

export function createProductProjectionReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const record = (primaryKey: string) => readCurrentProjection(owner, viewer, primaryKey);

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
    query(params: Record<string, unknown>) {
      return listCurrentProducts(owner, viewer, "projection", productCatalogQuerySchema.parse(catalogueQuery(params)));
    },
    record,
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "projection", primaryKey);
    },
    grants(primaryKey: string) {
      return catalogueGrants(owner, viewer, "projection", primaryKey);
    },
    async form(primaryKey: string, params: FormParams) {
      const projection = await record(primaryKey);
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
