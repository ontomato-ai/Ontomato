import { z } from "zod";
import {
  applicationCatalogueCreateSchema, applicationCatalogueFormRequestSchema, applicationCatalogueQueryResultSchema,
  applicationCatalogueRecordSchema, applicationEntriesUpdateSchema, applicationIdentityUpdateSchema,
  type ApplicationCatalogueFormRequest,
} from "@ontomato/contracts/application-catalogue";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import { panelFormDescriptionSchema, panelRecordFieldText, type PanelFormDescription, type PanelFormField, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, APPLICATION, APPLICATION_PANEL_USE, PRODUCT_PANEL } from "@ontomato/contracts/platform-object-types";
import { allowsStandalone, applicationCatalogSchema, applicationRootPath, isPanelApplication, isPlatformCatalogApplication } from "@ontomato/contracts/platform-identity";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { applicationPanelUseSchema, isApplicationPanelUse, registerApplicationPanelUsesRequestSchema, type ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { applicationCatalogueSortSchema } from "@ontomato/contracts/product-catalog-query";
import { readFavorites } from "../platform-home/service";
import { config } from "../../config/application";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { createLogger } from "../../logging/logger";
import { backendDelete, backendGet, backendPost, backendPut, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { listDefaultAgentOptions } from "../assistant/default-agents";
import { listCurrentProductNames } from "./catalog";
import { readCurrentPanel } from "./current";
import { assetGraphNode, createAssetGraph, panelGraphMembers } from "./asset-graph";

const applicationPath = "/platform/applications";
const cataloguePath = `${applicationPath}/catalogue`;
export const applicationDraftIdSchema = z.string().regex(/^app-[a-z0-9-]+$/);
const createPath = /^\/platform\/applications\/(app-[a-z0-9-]+)\/panel-uses\?create=true$/;
type FormParams = Partial<Pick<ApplicationCatalogueFormRequest, "values" | "changedField">>;
type EditFormParams = FormParams & {
  section: ApplicationCatalogueFormRequest["section"];
  entryId?: string;
};
const ownerSuccessSchema = z.object({ success: z.literal(true) });
const ownerData = <T>(text: string, schema: z.ZodType<T>) =>
  schema.parse(ownerSuccessSchema.extend({ data: z.unknown() }).parse(JSON.parse(text)).data);
const applicationExtendedScopeSchema = z.enum(["visible", "maintainable", "mine", "shared"]);
const pageParamSchema = z.union([
  z.number().int().min(1),
  z.object({ number: z.number().int().min(1), size: z.number().int().min(1).max(100) }).strict(),
]);
const querySchema = z.object({
  search: z.string().optional(),
  scope: applicationExtendedScopeSchema.optional(),
  sort: applicationCatalogueSortSchema.optional(),
  cursor: z.string().optional(),
  page: pageParamSchema.optional(),
  size: z.number().int().min(1).max(100).optional(),
}).strict();
const catalogueCountSchema = z.object({ total: z.number().int().nonnegative() }).strict();

type ApplicationCatalogueRow = z.infer<typeof applicationCatalogueQueryResultSchema>["rows"][number];
type ApplicationCatalogueDetail = z.infer<typeof applicationCatalogueRecordSchema>;

/** Canonical hash-route external link (`#/...?standalone=1`) for an application that allows standalone opening. */
export function applicationStandaloneLink(
  row: Pick<ApplicationCatalogueDetail, "id" | "entry" | "allowStandalone">,
): string | undefined {
  if (!allowsStandalone(row)) return undefined;
  const { path, home } = row.entry;
  if (path.startsWith("/__external/")) return undefined;
  const landing = path.startsWith("/apps/") ? applicationRootPath(row.id) : (home ?? path);
  const [routePath, search = ""] = landing.split("?");
  const query = new URLSearchParams(search);
  query.set("standalone", "1");
  return `#${routePath}?${query}`;
}

function summarizeThemeOverrides(theme: ApplicationCatalogueDetail["theme"] | undefined): string | undefined {
  if (!theme) return undefined;
  const parts: string[] = [];
  for (const [mode, bucket] of [["light", theme.light], ["dark", theme.dark]] as const) {
    const entries = Object.entries(bucket ?? {});
    if (entries.length > 0) {
      parts.push(`${mode}: ${entries.map(([key, value]) => `${key}=${value}`).join(", ")}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** Project the Java owner's catalogue row or detail onto the generic record shown by panel components. */
export function toApplicationPanelRecord(
  row: ApplicationCatalogueRow | ApplicationCatalogueDetail,
  locale?: string,
  extra?: { framePanelLabel?: string },
): PanelRecord {
  const language = resolveLocale(locale);
  const word = (key: string) => tForLocale(language, `panels.productCatalog.application.${key}`);
  const names = { kind: "localized", values: row.names } as const;
  const descriptions = { kind: "localized", values: row.descriptions } as const;
  const subtitle = panelRecordFieldText(descriptions, language, "en");
  const allowStandalone = allowsStandalone(row);
  const fields: PanelRecord["fields"] = {
    id: row.id,
    names,
    descriptions,
    icon: row.icon,
    entryCount: row.entryCount,
    canMaintain: row.canMaintain,
    canEditEntries: row.canEditEntries,
    allowStandalone,
    sourceKind: row.source,
    source: word(row.source),
    maintenance: word(row.canMaintain ? "maintainable" : "readOnly"),
    owner: row.ownerName ?? (row.source === "builtin" ? word("platformOwner") : ""),
    ...(row.updatedAt !== undefined && { updatedAt: row.updatedAt }),
  };
  const fieldLabels: NonNullable<PanelRecord["fieldLabels"]> = {
    id: word("id"),
    names: tForLocale(language, "panels.productCatalog.name"),
    descriptions: tForLocale(language, "panels.productCatalog.description"),
    icon: word("icon"),
    allowStandalone: word("allowStandalone"),
    source: word("source"),
    maintenance: word("maintenance"),
    entryCount: word("entryCount"),
    owner: word("owner"),
    ...(row.updatedAt !== undefined && { updatedAt: word("updatedAt") }),
  };
  if ("entry" in row) {
    const { path, home, renderer } = row.entry;
    fields.path = path;
    fields.openPath = home ?? path;
    fieldLabels.path = word("path");
    if (home !== undefined) {
      fields.home = home;
      fieldLabels.home = word("home");
    }
    if (renderer !== undefined) {
      fields.renderer = renderer;
      fieldLabels.renderer = word("renderer");
    }
    if (row.framePanelId !== undefined) {
      fields.framePanel = {
        kind: "reference",
        className: PRODUCT_PANEL,
        primaryKey: row.framePanelId,
        label: extra?.framePanelLabel || row.framePanelId,
      };
      fieldLabels.framePanel = word("framePanel");
    }
    const externalLink = applicationStandaloneLink(row);
    if (externalLink !== undefined) {
      fields.externalLink = externalLink;
      fieldLabels.externalLink = word("externalLink");
    }
    const themeSummary = summarizeThemeOverrides(row.theme);
    if (themeSummary !== undefined) {
      fields.themeSummary = themeSummary;
      fieldLabels.themeSummary = word("themeOverrides");
    }
    const publicDeclaration = {
      id: row.id,
      source: row.source,
      names: row.names,
      descriptions: row.descriptions,
      icon: row.icon,
      ...(row.allowStandalone !== undefined && { allowStandalone: row.allowStandalone }),
      entry: row.entry,
      panelUses: row.panelUses,
      groups: row.groups,
      ...(row.framePanelId !== undefined && { framePanelId: row.framePanelId }),
      ...(row.theme !== undefined && { theme: row.theme }),
    };
    fields.declarationJson = JSON.stringify(publicDeclaration, null, 2);
    fieldLabels.declarationJson = tForLocale(language, "panels.productCatalog.projection.definitionJson");
  }
  const outputs: PanelRecord["outputs"] = "entry" in row
    ? {
        canMaintain: row.canMaintain,
        canEditEntries: row.canEditEntries,
        openPath: row.entry.home ?? row.entry.path,
      }
    : undefined;
  return {
    primaryKey: row.id,
    className: APPLICATION,
    label: panelRecordFieldText(names, language, "en") || row.id,
    ...(subtitle && { subtitle }),
    fields,
    fieldLabels,
    tones: { source: row.source === "builtin" ? "info" : "default", maintenance: row.canMaintain ? "success" : "info" },
    ...(outputs !== undefined && { outputs }),
  };
}

const GALLERY_EXCLUDED_APP_IDS = new Set(["home", "personal-workspace", "workplace", "application-gallery"]);
const logger = createLogger("application-catalogue");
const GALLERY_RAIL_ORDER = ["top", "apps", "bottom"] as const;

export function applicationCatalogueClient(viewer: AssistantCredentials) {
  const options = () => ({
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  });
  const url = (path: string) => config.dataQuery.baseUrl + path;
  const entryPath = (id: string) => `${applicationPath}/${encodeURIComponent(id)}`;

  return {
    async navigation() {
      const response = await backendGet("application-navigation", url(`${applicationPath}?purpose=navigation`), options());
      return ownerData(response.text, applicationCatalogSchema).filter(isPlatformCatalogApplication);
    },
    async query(params: Record<string, unknown>) {
      const { page, ...rest } = querySchema.parse(params);
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) query.set(key, String(value));
      }
      if (page !== undefined) {
        if (typeof page === "number") {
          query.set("page", String(page));
        } else {
          query.set("page", String(page.number));
          if (rest.size === undefined) query.set("size", String(page.size));
        }
      }
      const response = await backendGet("application-catalogue", url(`${cataloguePath}?${query}`), options());
      return ownerData(response.text, applicationCatalogueQueryResultSchema);
    },
    async count() {
      const query = new URLSearchParams({ countOnly: "true" });
      const response = await backendGet("application-catalogue-count", url(`${cataloguePath}?${query}`), options());
      return ownerData(response.text, catalogueCountSchema);
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
    async publishSource(id: string, values: unknown) {
      const response = await backendPut("application-catalogue-publish-source", url(`${entryPath(id)}/panel-uses`),
        registerApplicationPanelUsesRequestSchema.parse(values), options());
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
  const isAgent = (field: PanelFormField) => field.path === "/defaultAgent" && field.control.kind === "select";
  const topAgent = description.fields.find(isAgent);
  if (topAgent) {
    const options = await choices();
    return {
      ...description,
      fields: description.fields.map((field): PanelFormField =>
        isAgent(field) && field.control.kind === "select" ? { ...field, control: { ...field.control, options } } : field),
    };
  }
  const entries = description.fields.find(field => field.path === "/panelUses");
  if (entries?.control.kind !== "object-array") return description;
  const control = entries.control;
  if (!control.itemFields.some(isAgent)) return description;
  const options = await choices();
  const itemFields = control.itemFields.map((field): PanelFormField =>
    isAgent(field) && field.control.kind === "select" ? { ...field, control: { ...field.control, options } } : field);
  return { ...description, fields: description.fields.map(field => field === entries ? { ...entries, control: { ...control, itemFields } } : field) };
}

export function createApplicationReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const client = applicationCatalogueClient(viewer);
  const { record } = client;
  const language = resolveLocale(viewer.locale);
  const word = (key: string) => tForLocale(language, `panels.productCatalog.application.${key}`);
  const form = async (input: ApplicationCatalogueFormRequest) =>
    withDefaultAgentChoices(await client.form(input), () => defaultAgentChoices(owner.domainId, viewer.locale));

  function panelNameMap(): Promise<Map<string, string>> {
    return listCurrentProductNames(owner, viewer, "panel");
  }

  async function agentLabelMap(): Promise<Map<string, string>> {
    try {
      const options = await listDefaultAgentOptions(owner.domainId, viewer.locale);
      const map = new Map<string, string>();
      for (const option of options) {
        const value = option.value;
        if (value && typeof value === "object") {
          if ("id" in value && typeof value.id === "string") map.set(`id:${value.id}`, option.label);
          if ("agentKind" in value && typeof value.agentKind === "string") map.set(`preset:${value.agentKind}`, option.label);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  return {
    async available(params: { category?: string; search?: string; favoritesOnly?: boolean }): Promise<PanelRecordQuery> {
      const category = params.category ?? "all";
      const includeApps = category !== "agents";
      const includeAgents = category === "all" || category === "agents";
      const [catalog, agentResult, favoritesResult] = await Promise.all([
        includeApps ? client.navigation() : Promise.resolve([]),
        includeAgents
          ? import("../assistant/service").then(({ assistantService }) => assistantService.agents(owner, viewer))
          : Promise.resolve({ agents: [] }),
        readFavorites(owner).then(
          items => ({ ok: true as const, items }),
          error => ({ ok: false as const, error }),
        ),
      ]);
      if (!favoritesResult.ok && params.favoritesOnly) {
        throw favoritesResult.error;
      }
      if (!favoritesResult.ok) {
        logger.warn("Failed to read personal favorites for application gallery", {
          error: favoritesResult.error instanceof Error ? favoritesResult.error.message : String(favoritesResult.error),
        });
      }
      const favorites = favoritesResult.ok ? favoritesResult.items : [];
      const diagnostics = favoritesResult.ok
        ? undefined
        : [tForLocale(language, "panels.favorite.loadUnavailable")];
      const favoriteAppSet = new Set(favorites.filter(item => item.kind === "application").map(item => item.id));
      const favoriteAgentSet = new Set(favorites.filter(item => item.kind === "agent").map(item => item.id));
      const visibleApps = catalog.filter(app => !GALLERY_EXCLUDED_APP_IDS.has(app.id));
      const enabledAgents = agentResult.agents.filter(agent => agent.enabled);
      const queryText = params.search?.trim().toLocaleLowerCase() ?? "";

      const toAppRecord = (app: (typeof visibleApps)[number]): PanelRecord | undefined => {
        if (category !== "all" && app.category !== category) return undefined;
        const label = localizedApplicationText(app.names, language) ?? app.id;
        const description = localizedApplicationText(app.descriptions, language);
        if (queryText && !`${label}\n${description ?? ""}`.toLocaleLowerCase().includes(queryText)) {
          return undefined;
        }
        const openPath = app.entry.path.startsWith("/__external/") || app.kind === "link"
          ? app.entry.path
          : isPanelApplication(app) || app.kind === "connected"
            ? applicationRootPath(app.id)
            : (app.entry.home ?? app.entry.path);
        return {
          primaryKey: app.id,
          className: APPLICATION,
          label,
          ...(description && { subtitle: description }),
          fields: {
            category: app.category,
            icon: app.icon,
            ...(favoritesResult.ok && { favorite: favoriteAppSet.has(app.id) }),
          },
          outputs: { openPath },
        };
      };

      const toAgentRecord = (agent: (typeof enabledAgents)[number]): PanelRecord | undefined => {
        const description = agent.description?.trim() || undefined;
        if (queryText && !`${agent.name}\n${description ?? ""}`.toLocaleLowerCase().includes(queryText)) {
          return undefined;
        }
        return {
          primaryKey: agent.id,
          className: AGENT_DEFINITION,
          label: agent.name,
          ...(description && { subtitle: description }),
          fields: {
            category: "agents",
            icon: agent.icon ?? "",
            ...(favoritesResult.ok && { favorite: favoriteAgentSet.has(agent.id) }),
          },
          outputs: {
            openPath: `/agents/chat?agentId=${encodeURIComponent(agent.id)}`,
          },
        };
      };

      if (params.favoritesOnly) {
        const appById = new Map(visibleApps.map(app => [app.id, app]));
        const agentById = new Map(enabledAgents.map(agent => [agent.id, agent]));
        const rows: PanelRecord[] = [];
        for (const item of favorites) {
          if (item.kind === "application" && includeApps) {
            const app = appById.get(item.id);
            const record = app ? toAppRecord(app) : undefined;
            if (record) rows.push(record);
          } else if (item.kind === "agent" && includeAgents) {
            const agent = agentById.get(item.id);
            const record = agent ? toAgentRecord(agent) : undefined;
            if (record) rows.push(record);
          }
        }
        return { rows, total: rows.length };
      }

      const orderedApps = GALLERY_RAIL_ORDER.flatMap(rail => visibleApps.filter(app => (app.rail ?? "apps") === rail));
      const appRecords = orderedApps.flatMap(app => {
        const record = toAppRecord(app);
        return record ? [record] : [];
      });
      const agentRecords = enabledAgents.flatMap(agent => {
        const record = toAgentRecord(agent);
        return record ? [record] : [];
      });
      const rows = [...appRecords, ...agentRecords];
      return {
        rows,
        total: rows.length,
        ...(diagnostics && { diagnostics }),
      };
    },
    async count() {
      const { total } = await client.count();
      return { rows: [], total };
    },
    async query(params: Record<string, unknown>) {
      const { rows, total, nextCursor } = await client.query(params);
      return {
        rows: rows.map(row => toApplicationPanelRecord(row, viewer.locale)),
        ...(total !== undefined && { total }),
        ...(nextCursor !== undefined && { nextCursor }),
      };
    },
    async record(primaryKey: string) {
      const detail = await record(primaryKey);
      const framePanelLabel = detail.framePanelId ? (await panelNameMap()).get(detail.framePanelId) : undefined;
      return toApplicationPanelRecord(detail, viewer.locale, { framePanelLabel });
    },
    async form(primaryKey: string, { section, entryId, values, changedField = null }: EditFormParams) {
      const target = { kind: "object", objectType: APPLICATION, primaryKey } as const;
      if (section === "create" || (section === "entry" && entryId === "__copy__")) {
        const { id, ...formValues } = values ?? {};
        const draftId = applicationDraftIdSchema.optional().parse(id);
        const draft = await form({
          section: "create",
          target,
          values: values === undefined ? undefined : formValues,
          changedField,
        });
        const allocatedId = createPath.exec(draft.save.path)?.[1];
        if (!allocatedId || (draftId !== undefined && draftId !== allocatedId))
          throw new HttpError(502, "The application owner returned an invalid draft save path", "APPLICATION_DRAFT_INVALID");
        return { ...draft, values: { ...draft.values, id: allocatedId } };
      }
      const schema = section === "identity"
        ? applicationIdentityUpdateSchema
        : section === "entry"
          ? applicationPanelUseSchema
          : applicationEntriesUpdateSchema;
      if (values !== undefined && !schema.safeParse(values).success) {
        const current = await form({ section, ...(entryId !== undefined && { entryId }), target, changedField: null });
        values = { ...current.values, ...values };
      }
      return form({ section, ...(entryId !== undefined && { entryId }), target, values, changedField });
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
      const { id, entry, panelUses, groups, framePanelId, theme } = await record(primaryKey);
      return {
        applicationId: id, entry, panelUses, groups,
        ...(framePanelId !== undefined && { framePanelId }),
        ...(theme !== undefined && { theme }),
      };
    },
    async entryRows(primaryKey: string): Promise<PanelRecord[]> {
      const detail = await record(primaryKey);
      const [panels, agents] = await Promise.all([panelNameMap(), agentLabelMap()]);
      const groupName = (key?: string) => {
        if (!key) return "—";
        const found = detail.groups.find(group => group.key === key);
        if (!found) return key;
        return panelRecordFieldText({ kind: "localized", values: found.names }, language, "en") || key;
      };
      const agentLabel = (agent: ApplicationPanelUse["defaultAgent"]) => {
        if (!agent) return word("defaultAgentFallback");
        if (agent.kind === "id") return agents.get(`id:${agent.id}`) ?? agent.id;
        if (agent.kind === "preset") return agents.get(`preset:${agent.agentKind}`) ?? agent.agentKind;
        return word("defaultAgentFallback");
      };
      return detail.panelUses.map((use): PanelRecord => {
        const displayName = use.names
          ? panelRecordFieldText({ kind: "localized", values: use.names }, language, "en") || use.id
          : use.id;
        const panelEntry = isApplicationPanelUse(use);
        const panelLabel = panelEntry ? (panels.get(use.panelId) ?? use.panelId) : "—";
        return {
          primaryKey: use.id,
          className: APPLICATION_PANEL_USE,
          label: displayName,
          fields: {
            path: use.path,
            panelId: panelEntry ? use.panelId : "",
            panel: panelEntry
              ? { kind: "reference", className: PRODUCT_PANEL, primaryKey: use.panelId, label: panelLabel }
              : "—",
            group: groupName(use.groupKey),
            defaultAgent: panelEntry ? agentLabel(use.defaultAgent) : "—",
            canEdit: detail.canEditEntries,
          },
          fieldLabels: {
            path: word("entryPath"),
            panel: word("entryPanel"),
            group: word("entryGroup"),
            defaultAgent: word("entryAgent"),
          },
        };
      });
    },
    async usedPanels(primaryKey: string): Promise<PanelRecord[]> {
      const detail = await record(primaryKey);
      const panels = await panelNameMap();
      const ids = [...new Set(detail.panelUses.filter(isApplicationPanelUse).map(use => use.panelId).filter(Boolean))];
      return ids.map((panelId): PanelRecord => {
        const accessible = panels.has(panelId);
        const label = panels.get(panelId) ?? panelId;
        return {
          primaryKey: panelId,
          className: PRODUCT_PANEL,
          label,
          ...(label !== panelId && { subtitle: panelId }),
          fields: { id: panelId, accessible },
          fieldLabels: { id: word("entryPanel") },
        };
      });
    },
    async referenceGraph(primaryKey: string): Promise<PanelRecord> {
      const detail = await record(primaryKey);
      const [panels, projectionNames] = await Promise.all([
        panelNameMap(),
        listCurrentProductNames(owner, viewer, "projection"),
      ]);
      const graph = createAssetGraph();
      const appLabel = localizedApplicationText(detail.names, language) ?? detail.id;
      const app = assetGraphNode("application", { id: detail.id, name: appLabel });
      graph.addNode(app);

      const panelIds = [
        ...(detail.framePanelId ? [detail.framePanelId] : []),
        ...detail.panelUses.filter(isApplicationPanelUse).map(use => use.panelId).filter(Boolean),
      ];
      const uniquePanelIds = [...new Set(panelIds)];
      for (const id of uniquePanelIds) {
        const node = assetGraphNode("panel", { id, name: panels.get(id) ?? id });
        graph.addNode(node);
        graph.addEdge(app.id, node.id, "navigates");
      }

      // Populate outgoing relationships for accessible panels.
      const accessiblePanelIds = uniquePanelIds.filter(panelId => panels.has(panelId));
      const loadedPanels = await Promise.all(
        accessiblePanelIds.map(panelId => readCurrentPanel(owner, viewer, panelId).catch(() => null)),
      );
      for (const loaded of loadedPanels) {
        if (!loaded) continue;
        for (const { id, kind } of panelGraphMembers(loaded)) {
          const names = kind === "projection" ? projectionNames : panels;
          const node = assetGraphNode(kind, { id, name: names.get(id) ?? id });
          graph.addNode(node);
          graph.addEdge(`asset:${loaded.id}`, node.id, "contains");
        }
      }

      return {
        primaryKey: detail.id,
        className: APPLICATION,
        label: appLabel,
        fields: {
          graph: { kind: "json", value: graph.build() },
        },
      };
    },
  };
}
