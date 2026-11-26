import { z, ZodError } from "zod";
import {
  applicationMenuEntrySchema, isApplicationPanelUse,
} from "@ontomato/contracts/product-panels";
import {
  pageCatalogResponseSchema, pageDescriptionResponseSchema, pageSearchResponseSchema,
  type PageCatalogEntry, type PageCatalogRequest, type PageDescriptionRequest, type PageSearchRequest,
} from "@ontomato/contracts/page-context";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { AssistantOwner } from "../assistant/store";
import { platformHomeStore } from "../platform-home/store";
import { requirePanelEntry } from "./application-use";
import { generatePanelPageDescription } from "./skill-package";
import { readCurrentPanelRecord } from "./current";

const localized = z.record(z.string(), z.string());
const applicationSummarySchema = z.object({
  id: z.string().min(1),
  names: localized.optional(),
  descriptions: localized.optional(),
}).passthrough();
const applicationDetailSchema = applicationSummarySchema.extend({
  groups: z.array(z.object({
    key: z.string().min(1),
    names: localized.optional(),
    descriptions: localized.optional(),
    sort: z.number().optional(),
  }).passthrough()).optional(),
  panelUses: z.array(applicationMenuEntrySchema).optional(),
}).passthrough();
const navigationSchema = z.object({ success: z.literal(true), data: z.array(applicationSummarySchema) });
const detailResponseSchema = z.object({ success: z.literal(true), data: applicationDetailSchema });

async function javaGet<T>(operation: string, path: string, credentials: AssistantCredentials, schema: z.ZodType<T>): Promise<T> {
  const response = await backendGet(operation, `${config.dataQuery.baseUrl}${path}`, {
    headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey),
    retries: 1,
  });
  return schema.parse(JSON.parse(response.text));
}

async function navigationApplications(credentials: AssistantCredentials) {
  const { data } = await javaGet("page-catalog-navigation", "/platform/applications?purpose=navigation", credentials, navigationSchema);
  return data;
}

async function applicationDetail(applicationId: string, credentials: AssistantCredentials) {
  const { data } = await javaGet("page-catalog-application", `/platform/applications/${encodeURIComponent(applicationId)}`, credentials, detailResponseSchema);
  return data;
}

function localizedText(values: Record<string, string> | undefined, locale?: string) {
  if (!values) return undefined;
  const language = locale?.split("-")[0];
  return (locale && values[locale]) || (language && values[language]) || values.en || Object.values(values)[0];
}

async function personalizeHomeEntries(owner: AssistantOwner, entries: PageCatalogEntry[]) {
  const homePanelId = entries.some(entry => entry.applicationId === "home" && entry.useId === "home")
    ? await platformHomeStore.homePanelId(owner)
    : null;
  if (homePanelId === null) return entries;
  return entries.map(entry => entry.applicationId === "home" && entry.useId === "home"
    ? { ...entry, panelId: homePanelId }
    : entry);
}

function catalogEntry(applicationId: string, use: z.infer<typeof applicationMenuEntrySchema>): PageCatalogEntry {
  return {
    applicationId,
    entryKey: use.id,
    useId: use.id,
    pageKey: use.pageKey,
    panelId: isApplicationPanelUse(use) ? use.panelId : null,
    kind: isApplicationPanelUse(use) ? "panel" : use.kind,
    path: use.path,
    ...(use.names && { names: use.names }),
    ...(use.descriptions && { descriptions: use.descriptions }),
    ...(use.groupKey && { groupKey: use.groupKey }),
  };
}

/** Hierarchical page discovery over the Java admission projection. Every response contains only admitted entrances. */
export async function readPageCatalog(owner: AssistantOwner, credentials: AssistantCredentials, request: PageCatalogRequest) {
  const applications = await navigationApplications(credentials);
  if (!request.applicationId) {
    return pageCatalogResponseSchema.parse({
      applications: applications.map(({ id, names, descriptions }) => ({ applicationId: id, ...(names && { names }), ...(descriptions && { descriptions }) })),
    });
  }
  const applicationId = request.applicationId;
  const application = applications.find(({ id }) => id === applicationId);
  if (!application) throw new HttpError(403, "The initiating user does not have access to this application", "FORBIDDEN");
  const detail = await applicationDetail(applicationId, credentials);
  const entries = await personalizeHomeEntries(owner, (detail.panelUses ?? []).map(use => catalogEntry(applicationId, use)));
  const groups = (detail.groups ?? []).map(group => ({
    key: group.key,
    ...(group.names && { names: group.names }),
    ...(group.descriptions && { descriptions: group.descriptions }),
    entries: entries.filter(entry => entry.groupKey !== undefined && entry.groupKey === group.key),
  })).filter(group => group.entries.length > 0);
  return pageCatalogResponseSchema.parse({
    applications: [{ applicationId: detail.id, ...(detail.names && { names: detail.names }), ...(detail.descriptions && { descriptions: detail.descriptions }) }],
    groups,
    entries: entries.filter(entry => !entry.groupKey),
  });
}

type SearchEntry = {
  application: z.infer<typeof applicationSummarySchema>;
  detail: z.infer<typeof applicationDetailSchema>;
  entry: PageCatalogEntry;
  group?: { key: string; names?: Record<string, string>; descriptions?: Record<string, string> };
  panelText: string[];
};

function textValues(...values: (Record<string, string> | undefined | string)[]) {
  return values.flatMap(value => typeof value === "string" ? [value] : value ? Object.values(value) : []);
}

function matches(values: readonly string[], needle: string) {
  return values.some(value => value.toLocaleLowerCase().includes(needle));
}

/** Small permission-bound scan over admitted entries; deliberately no index or search service. */
async function searchablePanelText(owner: AssistantOwner, credentials: AssistantCredentials, panelId: string) {
  try {
    const panel = await readCurrentPanelRecord(owner, credentials, panelId);
    return [panel.name, panel.description];
  } catch (error) {
    // Entry admission and object USE are separate grants. An admitted entry remains searchable by its own text;
    // a panel the reader cannot use contributes no name or description to the match.
    if ((error instanceof HttpError && [403, 404, 502].includes(error.status)) || error instanceof ZodError) return [];
    throw error;
  }
}

export async function searchPages(owner: AssistantOwner, credentials: AssistantCredentials, request: PageSearchRequest) {
  const needle = request.query.toLocaleLowerCase();
  const applications = await navigationApplications(credentials);
  const rows: SearchEntry[] = [];
  for (const application of applications) {
    const detail = await applicationDetail(application.id, credentials);
    const entries = await personalizeHomeEntries(owner, (detail.panelUses ?? []).map(use => catalogEntry(application.id, use)));
    for (const entry of entries) {
      const group = detail.groups?.find(({ key }) => key === entry.groupKey);
      let panelText: string[] = [];
      if (entry.panelId) panelText = await searchablePanelText(owner, credentials, entry.panelId);
      rows.push({ application, detail, entry, group, panelText });
    }
  }
  const results = rows.flatMap(({ application, entry, group, panelText }) => {
    const applicationText = textValues(application.id, application.names, application.descriptions);
    const groupText = group ? textValues(group.key, group.names, group.descriptions) : [];
    const entryText = textValues(entry.entryKey, entry.pageKey, entry.names, entry.descriptions, entry.path);
    const hit = matches(applicationText, needle) || matches(groupText, needle) || matches(entryText, needle) || matches(panelText, needle);
    if (!hit) return [];
    const locale = credentials.locale;
    const applicationLabel = localizedText(application.names, locale) ?? application.id;
    const entryLabel = localizedText(entry.names, locale) ?? entry.entryKey;
    const groupLabel = group && (localizedText(group.names, locale) ?? group.key);
    return [{
      application: {
        applicationId: application.id,
        ...(application.names && { names: application.names }),
        ...(application.descriptions && { descriptions: application.descriptions }),
      },
      entry,
      breadcrumb: groupLabel ? [applicationLabel, groupLabel, entryLabel] : [applicationLabel, entryLabel],
    }];
  });
  return pageSearchResponseSchema.parse({ results });
}

/** Generate the current Markdown page instructions for one admitted panel entrance. */
export async function readPageDescription(owner: AssistantOwner, credentials: AssistantCredentials, request: PageDescriptionRequest) {
  const resolution = await requirePanelEntry(credentials, { applicationId: request.applicationId, useId: request.entryKey }, owner);
  if (!isApplicationPanelUse(resolution.use) || resolution.use.pageKey !== request.pageKey)
    throw new HttpError(422, "This entry has no panel page description", "PAGE_DESCRIPTION_UNAVAILABLE");
  const markdown = await generatePanelPageDescription(owner, credentials, resolution.use.panelId, {
    applicationId: request.applicationId,
    useId: resolution.use.id,
    path: resolution.use.path,
    ...(resolution.use.names && { names: resolution.use.names }),
    ...(resolution.menu.names && { applicationNames: resolution.menu.names }),
  }, Object.keys(resolution.use.inputs ?? {}));
  return pageDescriptionResponseSchema.parse({ markdown });
}
