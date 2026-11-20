import { z } from "zod";
import {
  applicationCatalogueCreateSchema, applicationCatalogueFormRequestSchema, applicationCatalogueQueryResultSchema,
  applicationCatalogueRecordSchema, applicationEntriesUpdateSchema, applicationIdentityUpdateSchema,
  type ApplicationCatalogueFormRequest,
} from "@ontomato/contracts/application-catalogue";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { applicationCatalogueScopeSchema } from "@ontomato/contracts/product-catalog-query";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendDelete, backendGet, backendPost, backendPut, buildBackendHeaders } from "../../utils/backend-client";
import type { ProductOwner } from "../product-governance/grants";

const applicationPath = "/platform/applications";
const cataloguePath = `${applicationPath}/catalogue`;
const ownerSuccessSchema = z.object({ success: z.literal(true) });
const ownerData = <T>(text: string, schema: z.ZodType<T>) =>
  schema.parse(ownerSuccessSchema.extend({ data: z.unknown() }).parse(JSON.parse(text)).data);
const querySchema = z.object({
  search: z.string().optional(),
  scope: applicationCatalogueScopeSchema.optional(),
  cursor: z.string().optional(),
  size: z.number().int().min(1).max(100).optional(),
}).strict();

export function applicationCatalogueClient(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1 };
  const url = (path: string) => config.dataQuery.baseUrl + path;
  const entryPath = (id: string) => `${applicationPath}/${encodeURIComponent(id)}`;

  return {
    async query(params: Record<string, unknown>) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(querySchema.parse(params)))
        if (value !== undefined) query.set(key, String(value));
      const response = await backendGet("application-catalogue", url(`${cataloguePath}?${query}`), options);
      return ownerData(response.text, applicationCatalogueQueryResultSchema);
    },
    async record(primaryKey: string) {
      const response = await backendGet("application-catalogue-record", url(`${cataloguePath}/${encodeURIComponent(primaryKey)}`), options);
      return ownerData(response.text, applicationCatalogueRecordSchema);
    },
    async form(input: ApplicationCatalogueFormRequest) {
      const response = await backendPost("application-catalogue-form", url(`${cataloguePath}/form`),
        applicationCatalogueFormRequestSchema.parse(input), options);
      return ownerData(response.text, panelFormDescriptionSchema);
    },
    async create(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-create", url(`${entryPath(id)}/panel-uses?create=true`),
        applicationCatalogueCreateSchema.parse(values), options);
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async saveIdentity(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-identity", url(`${entryPath(id)}/identity`),
        applicationIdentityUpdateSchema.parse(values), options);
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async saveEntries(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-entries", url(`${entryPath(id)}/panel-uses`),
        applicationEntriesUpdateSchema.parse(values), options);
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async remove(id: string) {
      await backendDelete("application-catalogue-delete", url(entryPath(id)), options);
    },
  };
}

export function createApplicationReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials) {
  const { query, record, form } = applicationCatalogueClient(viewer);
  return {
    query, record, form,
    async entries(primaryKey: string) {
      const { id, entry, panelUses } = await record(primaryKey);
      return { applicationId: id, entry, panelUses };
    },
  };
}
