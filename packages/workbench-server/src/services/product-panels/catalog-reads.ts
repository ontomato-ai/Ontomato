import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { directProjectionPortsSchema, type PanelFormDescription, type PanelFormField } from "@ontomato/contracts/panel-projection";
import {
  METRIC_CHART_COMPONENT, applicationPanelUsesResponseSchema, productCatalogQuerySchema,
  productCurrentIdParamsSchema, productPanelInputSchema, registerProductPanelRequestSchema,
  registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import type { ProductOwner } from "../product-governance/grants";
import { currentProductUsedBy, listCurrentProducts } from "./catalog";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { readCurrentPanel, readCurrentProjection } from "./current";

const jsonSchema = (schema: z.ZodTypeAny) => runtimeJsonObjectSchema.parse(zodToJsonSchema(schema, { effectStrategy: "input" }));
type FormParams = { values?: Record<string, unknown>; changedField?: string | null };
type CatalogueKind = "projection" | "panel";
const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });

function catalogueQuery(params: Record<string, unknown>) {
  const { search, size, scope, sort, cursor } = params;
  return productCatalogQuerySchema.parse({ q: search, limit: size, scope, sort, cursor });
}

function formFields(locale: string | undefined, editable: boolean, creating: boolean) {
  const label = (name: string) => tForLocale(locale, `panels.productCatalog.${name}`);
  const field = (path: string, schema: z.ZodTypeAny, control: PanelFormField["control"],
    { required = true, readOnly = !editable, help, labelKey = path.split("/").at(-1)! }: {
      required?: boolean; readOnly?: boolean; help?: string; labelKey?: string;
    } = {}): PanelFormField => ({
    path, label: label(labelKey), valueSchema: jsonSchema(schema), control, required, readOnly,
    ...(help && { help }),
  });
  const common = productPanelInputSchema.shape;
  const fields = [
    field("/name", common.name, { kind: "text" }),
    field("/description", common.description, { kind: "text", multiline: true }),
    field("/visibility", common.visibility, {
      kind: "select", options: common.visibility.options.map(value => option(value, label(value))),
    }, { readOnly: !creating }),
  ];
  return { field, fields };
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
  return productCurrentIdParamsSchema.shape.id.parse(values?.id ?? randomUUID());
}

function commonValues({ name, description, visibility }: { name: string; description: string; visibility: "private" | "domain" }) {
  return { name, description, visibility };
}

export function createProductPanelReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const record = (primaryKey: string) => readCurrentPanel(owner, viewer, primaryKey);

  function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined);
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
      field("/manifest/events", manifestShape.events, { kind: "code", language: "json" }),
      field("/theme", theme, { kind: "code", language: "json" }, { required: false }),
    ], values, revision);
  }

  return {
    query(params: Record<string, unknown>) {
      return listCurrentProducts(owner, viewer, "panel", catalogueQuery(params));
    },
    record,
    async members(primaryKey: string) {
      return (await record(primaryKey)).manifest.members;
    },
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "panel", primaryKey);
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
        manifest: { state: {}, members: {}, events: {} },
        ...params.values, id,
      }, true);
    },
  };
}

export function createProductProjectionReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const record = (primaryKey: string) => readCurrentProjection(owner, viewer, primaryKey);

  async function describeForm(id: string, values: Record<string, unknown>, editable: boolean, revision?: number, chart = false) {
    const { field, fields } = formFields(viewer.locale, editable, revision === undefined);
    if (chart) return formResult("projection", id, fields, values, revision);
    const { components } = await readPanelComponentCatalogue();
    const candidates = [...components].filter(([key, item]) => key !== METRIC_CHART_COMPONENT && item.data !== undefined);
    const component = candidates.find(([key]) => key === values.componentId)?.[1];
    const schema = directProjectionPortsSchema.shape;
    return formResult("projection", id, [
      ...fields,
      field("/componentId", schema.componentId, {
        kind: "select", options: candidates.map(([value, item]) => option(value, item.componentId)),
      }, { labelKey: "component" }),
      field("/data", schema.data, { kind: "code", language: "json" }),
      field("/config", schema.config, { kind: "code", language: "json" }, {
        help: component?.config?.map(property => `${property.name}: ${property.type}`).join("\n"),
      }),
      field("/inputs", schema.inputs, { kind: "code", language: "json" }),
      field("/outputs", schema.outputs, { kind: "code", language: "json" }),
      field("/operations", schema.operations, { kind: "code", language: "json" }, { required: false }),
    ], values, revision);
  }

  return {
    query(params: Record<string, unknown>) {
      return listCurrentProducts(owner, viewer, "projection", catalogueQuery(params));
    },
    record,
    usedBy(primaryKey: string) {
      return currentProductUsedBy(owner, viewer, "projection", primaryKey);
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

const entriesEnvelope = z.object({ success: z.literal(true), data: applicationPanelUsesResponseSchema });

export function createApplicationReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials) {
  return {
    async entries(primaryKey: string) {
      const response = await backendGet("application-catalogue-entries",
        `${config.dataQuery.baseUrl}/platform/applications/${encodeURIComponent(primaryKey)}/panel-uses`,
        { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1 });
      return entriesEnvelope.parse(JSON.parse(response.text)).data;
    },
  };
}
