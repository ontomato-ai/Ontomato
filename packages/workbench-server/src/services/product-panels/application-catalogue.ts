import { z } from "zod";
import {
  applicationCatalogueCreateSchema, applicationCatalogueFormRequestSchema, applicationCatalogueQueryResultSchema,
  applicationCatalogueRecordSchema, applicationEntriesUpdateSchema, applicationIdentityUpdateSchema,
  type ApplicationCatalogueFormRequest,
} from "@ontomato/contracts/application-catalogue";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import { panelFormDescriptionSchema, type PanelFormDescription, type PanelFormField } from "@ontomato/contracts/panel-projection";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { applicationCatalogueScopeSchema, applicationCatalogueSortSchema } from "@ontomato/contracts/product-catalog-query";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendDelete, backendGet, backendPost, backendPut, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { readProductGrantRecords, type ProductOwner } from "../product-governance/grants";
import { listDefaultAgentOptions } from "../assistant/default-agents";

const applicationPath = "/platform/applications";
const cataloguePath = `${applicationPath}/catalogue`;
export const applicationDraftIdSchema = z.string().regex(/^app-[a-z0-9-]+$/);
const createPath = /^\/platform\/applications\/(app-[a-z0-9-]+)\/panel-uses\?create=true$/;
type FormParams = Partial<Pick<ApplicationCatalogueFormRequest, "values" | "changedField">>;
type EditFormParams = FormParams & { section: Exclude<ApplicationCatalogueFormRequest["section"], "create"> };
const ownerSuccessSchema = z.object({ success: z.literal(true) });
const ownerData = <T>(text: string, schema: z.ZodType<T>) =>
  schema.parse(ownerSuccessSchema.extend({ data: z.unknown() }).parse(JSON.parse(text)).data);
const querySchema = z.object({
  search: z.string().optional(),
  scope: applicationCatalogueScopeSchema.optional(),
  sort: applicationCatalogueSortSchema.optional(),
  cursor: z.string().optional(),
  size: z.number().int().min(1).max(100).optional(),
}).strict();

export function applicationCatalogueClient(viewer: AssistantCredentials) {
  const options = () => ({
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  });
  const url = (path: string) => config.dataQuery.baseUrl + path;
  const entryPath = (id: string) => `${applicationPath}/${encodeURIComponent(id)}`;

  return {
    async query(params: Record<string, unknown>) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(querySchema.parse(params)))
        if (value !== undefined) query.set(key, String(value));
      const response = await backendGet("application-catalogue", url(`${cataloguePath}?${query}`), options());
      return ownerData(response.text, applicationCatalogueQueryResultSchema);
    },
    async record(primaryKey: string) {
      const response = await backendGet("application-catalogue-record", url(`${cataloguePath}/${encodeURIComponent(primaryKey)}`), options());
      return ownerData(response.text, applicationCatalogueRecordSchema);
    },
    async form(input: ApplicationCatalogueFormRequest) {
      const response = await backendPost("application-catalogue-form", url(`${cataloguePath}/form`),
        applicationCatalogueFormRequestSchema.parse(input), options());
      return ownerData(response.text, panelFormDescriptionSchema);
    },
    async create(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-create", url(`${entryPath(id)}/panel-uses?create=true`),
        applicationCatalogueCreateSchema.parse(values), options());
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async saveIdentity(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-identity", url(`${entryPath(id)}/identity`),
        applicationIdentityUpdateSchema.parse(values), options());
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async saveEntries(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-entries", url(`${entryPath(id)}/panel-uses`),
        applicationEntriesUpdateSchema.parse(values), options());
      ownerSuccessSchema.parse(JSON.parse(response.text));
    },
    async remove(id: string) {
      await backendDelete("application-catalogue-delete", url(entryPath(id)), options());
    },
  };
}

/** The default agents an entry may name: the agent owner's list for this domain, in the reader's language. */
async function defaultAgentChoices(domainId: string, locale?: string): Promise<PanelFormOption[]> {
  return (await listDefaultAgentOptions(domainId, locale))
    .map(({ value, label }) => ({ value, label, description: null, disabled: false, disabledReason: null }));
}

/** The application owner declares each entry's default agent as a select without options; its options are the agent owner's. */
async function withDefaultAgentChoices(description: PanelFormDescription, choices: () => Promise<PanelFormOption[]>) {
  const entries = description.fields.find(field => field.path === "/panelUses");
  if (entries?.control.kind !== "object-array") return description;
  const control = entries.control;
  const isAgent = (field: PanelFormField) => field.path === "/defaultAgent" && field.control.kind === "select";
  if (!control.itemFields.some(isAgent)) return description;
  const options = await choices();
  const itemFields = control.itemFields.map((field): PanelFormField =>
    isAgent(field) && field.control.kind === "select" ? { ...field, control: { ...field.control, options } } : field);
  return { ...description, fields: description.fields.map(field => field === entries ? { ...entries, control: { ...control, itemFields } } : field) };
}

export function createApplicationReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const client = applicationCatalogueClient(viewer);
  const { query, record } = client;
  const form = async (input: ApplicationCatalogueFormRequest) =>
    withDefaultAgentChoices(await client.form(input), () => defaultAgentChoices(owner.domainId, viewer.locale));
  return {
    query, record,
    async grants(primaryKey: string) {
      if (!(await record(primaryKey)).canGrant)
        throw new HttpError(403, "Application edit Grant required", "PRODUCT_FORBIDDEN");
      const { grants } = await readProductGrantRecords(primaryKey, viewer);
      return { grants, shared: grants.some(grant => grant.principalKind === "domain" && grant.verb === "use") };
    },
    async form(primaryKey: string, { section, values, changedField = null }: EditFormParams) {
      const target = { kind: "object", objectType: APPLICATION, primaryKey } as const;
      const schema = section === "identity" ? applicationIdentityUpdateSchema : applicationEntriesUpdateSchema;
      if (values !== undefined && !schema.safeParse(values).success) {
        const current = await form({ section, target, changedField: null });
        values = { ...current.values, ...values };
      }
      return form({ section, target, values, changedField });
    },
    async createForm({ values, changedField = null }: FormParams) {
      const { id, ...formValues } = values ?? {};
      const draftId = applicationDraftIdSchema.optional().parse(id);
      const draft = await form({
        section: "create", target: { kind: "draft", id: draftId },
        values: values === undefined ? undefined : formValues, changedField,
      });
      const allocatedId = createPath.exec(draft.save.path)?.[1];
      if (!allocatedId || (draftId !== undefined && draftId !== allocatedId))
        throw new HttpError(502, "The application owner returned an invalid draft save path", "APPLICATION_DRAFT_INVALID");
      return { ...draft, values: { ...draft.values, id: allocatedId } };
    },
    async entries(primaryKey: string) {
      const { id, entry, panelUses } = await record(primaryKey);
      return { applicationId: id, entry, panelUses };
    },
  };
}
