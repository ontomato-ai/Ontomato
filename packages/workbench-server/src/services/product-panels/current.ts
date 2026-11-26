import { themeOverrideProblems } from "@ontomato/design-tokens/theme-overrides";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import {
  AGENT_CHAT_COMPONENT, METRIC_CHART_COMPONENT, builtinProductPanelInputSchema, chartProjectionSchema, productPanelInputSchema, productPanelSchema, productProjectionSchema,
  type ApplicationPanelReferencesRequest, type ProductPanel, type ProductProjection,
  type ProductPanelInput, type ProductProjectionInput, type RegisterProductProjectionRequest,
} from "@ontomato/contracts/product-panels";
import { domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import { matchesDirectPanelValue, panelPortAccepts } from "@ontomato/contracts/panel-manifest";
import type { PoolClient } from "pg";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { currentProductColumns, currentProductRecord, currentProductRows, currentProductTables, findCurrentProduct, findCurrentProducts, type CurrentProductKind, type CurrentProductRow } from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { HttpError } from "../../utils/errors";
import { tForLocale } from "../../i18n";
import type { ProductOwner } from "../product-governance/grants";
import type { ObjectPublicationAccess } from "@ontomato/contracts/object-publication";
import { requireAllowed, requireObject, writeFirstPublication } from "../product-governance/authorization";
import { currentDefinition, currentDefinitionAccess, definitionKinds, requireCurrentUseAllowed } from "./access";
import { notifyProductDefinitionChanged } from "./definition-stream";
import { assistantStore } from "../assistant/store";
import { configuredAssistantSkills } from "../assistant/skill-selection";
import { resolveDefaultAgent } from "../assistant/default-agents";
import { panelSkillRef } from "./skill-identity";
import { collectReferences, findPanelUsers, validateCurrentProductReferences } from "./references";
import { validateProjectionComponent } from "./component-catalogue";
import { panelDefinition, projectionDefinition } from "./render-definitions";
import { declaredProjectionAgents, entryDependencyCompiler, storedPanelAuthoringDefinition } from "./entry-dependency-compiler";
import { compileRegisteredPanelRoots, updatePanelDependencies } from "./entry-dependency-store";
import { deliverEntryDependencyPublications } from "./entry-dependency-publication";

type CurrentDefinition = ProductPanelInput | ProductProjectionInput;

export async function loadCurrentProduct(domainId: string, kind: CurrentProductKind, id: string, client?: Pick<PoolClient, "query">) {
  const row = await findCurrentProduct(domainId, kind, id, client);
  if (!row) throw new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE");
  return row;
}

export async function requireCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string, verb: "use" | "edit", client?: Pick<PoolClient, "query">) {
  const row = await loadCurrentProduct(owner.domainId, kind, id, client);
  if (verb === "edit" && row.domainId === null)
    throw new HttpError(403, "Platform definitions are read-only", "OBJECT_FORBIDDEN");
  await requireObject({
    ...currentDefinition(kind, row, owner.domainId), verb: verb === "use" ? "USE" : "EDIT",
  }, credentials);
  return row;
}

export function requireOrdinaryProjection(input: Pick<ProductProjectionInput, "componentId">) {
  if (input.componentId === METRIC_CHART_COMPONENT)
    throw new HttpError(400, "Register a chart through its source card", "CHART_SOURCE_REGISTRATION_REQUIRED");
}
async function readCurrentRecord(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, management: boolean,
) {
  const row = await findCurrentProduct(owner.domainId, kind, id);
  if (!row) {
    const label = kind === "panel" ? "Panel" : "Projection";
    throw new HttpError(404, management ? `${label} '${id}' does not exist` : "Current product definition not found", "PRODUCT_UNAVAILABLE");
  }
  const { decisions, editable } = await currentDefinitionAccess(kind, [row], owner.domainId, credentials);
  const canEdit = editable.has(id);
  if (!management || !canEdit) requireCurrentUseAllowed(kind, decisions[0], credentials.locale);
  return { row, editable: canEdit };
}

export async function readPanelManagementAccess(owner: ProductOwner, credentials: AssistantCredentials, row: CurrentProductRow) {
  const { decisions, editable } = await currentDefinitionAccess("panel", [row], owner.domainId, credentials);
  return { allowed: decisions[0].allowed || editable.has(row.id), editable: editable.has(row.id) };
}
export async function readCurrentProjection(owner: ProductOwner, credentials: AssistantCredentials, id: string, reportMissingToAuthor = false) {
  const { row, editable } = await readCurrentRecord(owner, credentials, "projection", id, reportMissingToAuthor);
  return projectionDefinition(row, editable);
}

export type CurrentProjectionBatchItem =
  | { ok: true; projection: ProductProjection }
  | { ok: false; error: unknown };

/**
 * Reads multiple projection records for render using one batch grant check, one database lookup, and at most one
 * edit-grant lookup for domain-owned rows, preserving per-projection 403/404 isolation.
 */
export async function readCurrentProjectionRecords(
  owner: ProductOwner, credentials: AssistantCredentials, ids: readonly string[],
): Promise<Map<string, CurrentProjectionBatchItem>> {
  const uniqueIds = [...new Set(ids)];
  const results = new Map<string, CurrentProjectionBatchItem>();
  if (!uniqueIds.length) return results;

  const rows = await findCurrentProducts(owner.domainId, "projection", uniqueIds);
  const available = [...rows.values()];
  const { decisions, editable } = await currentDefinitionAccess("projection", available, owner.domainId, credentials);
  const byId = new Map(available.map((row, index) => [row.id, decisions[index]]));
  for (const id of uniqueIds) {
    const row = rows.get(id);
    if (!row) {
      results.set(id, { ok: false, error: new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE") });
      continue;
    }
    try {
      requireAllowed(byId.get(id)!);
      results.set(id, { ok: true, projection: projectionDefinition(row, editable.has(id)) });
    } catch (error) {
      results.set(id, { ok: false, error });
    }
  }
  return results;
}
export async function readCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string, reportMissingToAuthor = false) {
  const { row, editable } = await readCurrentRecord(owner, credentials, "panel", id, reportMissingToAuthor);
  return panelDefinition(row, editable);
}

export async function readAccessibleCurrentDefinitions(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind,
) {
  const { rows } = await getPostgresPool().query<CurrentProductRow>(
    `SELECT ${currentProductColumns} FROM ${currentProductRows(kind)} AS definitions
     WHERE domain_id IS NULL OR domain_id=$1 ORDER BY id`, [owner.domainId],
  );
  const { decisions } = await currentDefinitionAccess(kind, rows, owner.domainId, credentials, false);
  return rows.filter((_, index) => decisions[index].allowed);
}

export async function readCurrentPanelLabel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const { row, editable } = await readCurrentRecord(owner, credentials, "panel", id, true);
  const record = currentProductRecord(row, editable);
  const parsed = productPanelInputSchema.pick({ name: true }).strip().safeParse(record);
  return parsed.success ? parsed.data.name : id;
}
export const readCurrentProjectionRecord = readCurrentProjection;
export const readCurrentPanelRecord = readCurrentPanel;

export async function requireDirectPanelMember(owner: ProductOwner, credentials: AssistantCredentials, panel: Pick<ProductPanel, "manifest">, key: string) {
  if (!Object.hasOwn(panel.manifest.members, key))
    throw new HttpError(403, `Panel does not declare member '${key}'`, "FORBIDDEN");
  const member = panel.manifest.members[key];
  if (!("projectionId" in member.target))
    throw new HttpError(422, "The member does not reference a fixed projection", "PANEL_MEMBER_TARGET_UNSUPPORTED");
  const row = await requireCurrentProduct(owner, credentials, "projection", member.target.projectionId, "use");
  return { member, projection: productProjectionSchema.parse(currentProductRecord(row, false)) };
}

async function currentForSave(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, revision: number) {
  domainProductIdSchema.parse(id);
  const existing = await findCurrentProduct(owner.domainId, kind, id);
  if (existing) await requireObject({ ...currentDefinition(kind, existing, owner.domainId), verb: "EDIT" }, credentials);
  if ((existing?.revision ?? 0) !== revision) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
  return existing;
}

async function validateProjectionForSave(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials, id: string, input: ProductProjectionInput) {
  await validateProjectionComponent(id, input, undefined, { domainId: owner.domainId, credentials, client });
  for (const { target, field } of declaredProjectionAgents(input)) {
    if (target.kind === "id" && !await assistantStore.findAgent(target.id, owner.domainId, client)) {
      throw new HttpError(400, `Projection '${id}', ${field}.id '${target.id}' is not in this domain`, "INVALID_PANEL_REFERENCE");
    }
  }
}

export async function insertCurrentProduct(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string, input: CurrentDefinition, publicationAccess?: ObjectPublicationAccess): Promise<CurrentProductRow> {
  domainProductIdSchema.parse(id);
  await requireObject({ create: definitionKinds[kind] }, credentials);
  const other = t(currentProductTables[kind === "panel" ? "projection" : "panel"]);
  const collision = await client.query(
    `SELECT id FROM ${other} WHERE domain_id=$1 AND id=$2 LIMIT 1`,
    [owner.domainId, id],
  );
  if (collision.rows.length) throw new HttpError(409, "Product identity already belongs to another collection", "PRODUCT_ID_CONFLICT");
  if ("componentId" in input) await validateProjectionForSave(client, owner, credentials, id, input);
  const result = await client.query(`INSERT INTO ${t(currentProductTables[kind])} (domain_id,id,owner_id,definition) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING ${currentProductColumns}`, [owner.domainId, id, owner.userId, JSON.stringify(input)]);
  if (!result.rows.length) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
  await updatePanelDependencies(client, owner.domainId, owner.userId, kind, id);
  const row = result.rows[0];
  if (publicationAccess) {
    const object = currentDefinition(kind, row, owner.domainId);
    await writeFirstPublication({ ...object, ownerFacts: { ...object.ownerFacts, state: "DRAFT" } }, publicationAccess, credentials);
  }
  return row;
}

async function save(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  input: CurrentDefinition, revision: number, solePanelId?: string, publicationAccess?: ObjectPublicationAccess) {
  const row = await transaction(async client => {
    await lockProducts(client, owner);
    if (revision !== 0 && "componentId" in input) await validateProjectionForSave(client, owner, credentials, id, input);
    if (solePanelId !== undefined) {
      const users = await findPanelUsers(owner.domainId, "projection", id, client);
      if (users.length !== 1 || users[0]!.id !== solePanelId)
        throw new HttpError(409, "The projection's referencing panels changed. Register again to check its current uses.", "PROJECTION_REUSE_CONFLICT");
    }
    await validateCurrentProductReferences(owner, credentials, kind, id, input, client);
    if (revision === 0) return insertCurrentProduct(client, owner, credentials, kind, id, input, publicationAccess);
    const result = await client.query(`UPDATE ${t(currentProductTables[kind])} SET definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2 AND revision=$4 RETURNING ${currentProductColumns}`, [owner.domainId, id, JSON.stringify(input), revision]);
    if (!result.rows.length) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
    await updatePanelDependencies(client, owner.domainId, owner.userId, kind, id);
    return result.rows[0];
  });
  await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind, id } });
  await deliverEntryDependencyPublications(owner.domainId);
  return currentProductRecord(row, true);
}
export async function saveCurrentProjection(
  owner: ProductOwner, credentials: AssistantCredentials, id: string, request: RegisterProductProjectionRequest, solePanelId?: string,
) {
  const existing = await currentForSave(owner, credentials, "projection", id, request.revision);
  if (!("data" in request)) {
    if (existing?.definition.componentId !== METRIC_CHART_COMPONENT)
      throw new HttpError(400, "Register a chart through its source card", "CHART_SOURCE_REGISTRATION_REQUIRED");
    const { name, description, visibility, revision } = request;
    const current = chartProjectionSchema.parse(currentProductRecord(existing, true));
    const { id: _id, domainId: _domainId, ownerId: _ownerId, revision: _revision, editable: _editable,
      createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = current;
    return productProjectionSchema.parse(await save(owner, credentials, "projection", id,
      { ...definition, name, description, visibility }, revision, solePanelId));
  }
  if (existing?.definition.componentId === METRIC_CHART_COMPONENT)
    throw new HttpError(400, "A registered chart cannot change its component, metric or source", "CHART_SOURCE_IMMUTABLE");
  const { revision, publicationAccess, ...input } = request;
  requireOrdinaryProjection(input);
  return productProjectionSchema.parse(await save(owner, credentials, "projection", id, input, revision, solePanelId, publicationAccess));
}

export async function saveCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string, input: ProductPanelInput, revision: number, publicationAccess?: ObjectPublicationAccess) {
  await currentForSave(owner, credentials, "panel", id, revision);
  return productPanelSchema.parse(await save(owner, credentials, "panel", id, input, revision, undefined, publicationAccess));
}

type ApplicationReferences = (ApplicationPanelReferencesRequest & { registrant: AssistantCredentials })
  | (Omit<ApplicationPanelReferencesRequest, "domainId"> & { domainId: null });

/** Validate a domain declaration for its registrant, or a built-in declaration at startup. */
export async function validateApplicationPanelReferences(request: ApplicationReferences, locale?: string) {
  const { domainId, framePanelId, uses, delivery, theme, frameConversationEntryIds } = request;
  if (theme) {
    const [issue] = themeOverrideProblems(theme);
    if (issue) {
      throw new HttpError(400, `Application theme '${issue.mode}.${issue.name}': ${issue.message}`, "INVALID_PANEL_THEME");
    }
  }
  if (framePanelId === undefined && !uses.length && !delivery.panels.length && !delivery.projections.length
    && !frameConversationEntryIds?.length) return;
  await transaction(async client => {
    if (domainId !== null) await lockProducts(client, { domainId });
    await validateApplicationReferences(client, request, locale);
  });
}

async function validateApplicationReferences(client: PoolClient,
  request: ApplicationReferences, locale?: string) {
  const { domainId, framePanelId, uses, delivery } = request;
  const panels = new Map<string, Pick<ProductPanel, "manifest">>();
  const projections = new Set<string>();
  const pending = new Set(uses.map(use => use.panelId));
  if (framePanelId !== undefined) pending.add(framePanelId);
  const roots = await findCurrentProducts(domainId, "panel", [...pending], client);
  const rootRows = [...pending].map(panelId => {
    const row = roots.get(panelId);
    if (!row) throw missingApplicationPanel(panelId);
    return row;
  });
  if (request.domainId !== null && rootRows.length) {
    const { decisions } = await currentDefinitionAccess("panel", rootRows, request.domainId, request.registrant, false);
    for (const [index, decision] of decisions.entries()) {
      if (!decision.allowed) {
        const panelId = rootRows[index].id;
        throw new HttpError(403, `Panel '${panelId}': ${decision.reason}`, decision.code, { panelId });
      }
    }
  }
  for (const panelId of pending) {
    const row = roots.get(panelId) ?? await findCurrentProduct(domainId, "panel", panelId, client);
    if (!row) throw missingApplicationPanel(panelId);
    const definition = storedPanelAuthoringDefinition(row.definition);
    const panel = (row.domainId === null ? builtinProductPanelInputSchema : productPanelInputSchema).parse(definition);
    panels.set(panelId, panel);
    for (const { target } of collectReferences(panel, new Map())) {
      (target.kind === "panel" ? pending : projections).add(target.id);
    }
  }

  const projectionRows = await findCurrentProducts(domainId, "projection", [...projections], client);
  const chatProjectionIds = new Set(
    [...projectionRows.values()]
      .filter(row => {
        const def = row.definition;
        return def && typeof def === "object" && !Array.isArray(def) && "componentId" in def
          && (def as { componentId?: unknown }).componentId === AGENT_CHAT_COMPONENT;
      })
      .map(row => row.id),
  );
  function panelContainsAgentChat(panelId: string, seen = new Set<string>()): boolean {
    if (seen.has(panelId)) return false;
    seen.add(panelId);
    const panel = panels.get(panelId);
    if (!panel) return false;
    return collectReferences(panel, new Map()).some(({ target }) => target.kind === "projection"
      ? chatProjectionIds.has(target.id)
      : panelContainsAgentChat(target.id, seen));
  }

  const frameHasAgentChat = framePanelId !== undefined && chatProjectionIds.size > 0 && panelContainsAgentChat(framePanelId);
  if (request.frameConversationEntryIds?.length && !frameHasAgentChat) {
    throw new HttpError(400, "Frame conversation entry requires an application frame containing AgentChat", "INVALID_FRAME_CONVERSATION_ENTRY");
  }
  const frame = framePanelId === undefined ? undefined : panels.get(framePanelId)!;
  const compile = entryDependencyCompiler(client, domainId);
  let definitions: Awaited<ReturnType<typeof assistantStore.agents>> | undefined;
  for (const use of uses) {
    const entryHasAgentChat = chatProjectionIds.size > 0 && panelContainsAgentChat(use.panelId);
    if (frameHasAgentChat && entryHasAgentChat) {
      throw new HttpError(400,
        `Entry '${use.id}' cannot mount AgentChat because the application frame already mounts AgentChat`,
        "INVALID_PANEL_ENTRY_DUAL_AGENT_CHAT");
    }
    if (entryHasAgentChat && use.pageComposer !== "none") {
      throw new HttpError(
        400,
        `Entry '${use.id}' mounts AgentChat and must declare pageComposer: "none"`,
        "INVALID_PANEL_ENTRY_PAGE_COMPOSER",
      );
    }
    const { state } = panels.get(use.panelId)!.manifest;
    for (const [name, ref] of Object.entries(use.inputs ?? {})) {
      if ("frameState" in ref && frame === undefined) {
        throw new HttpError(400, `Entry '${use.id}' input '${name}' requires an application frame for state '${ref.frameState}'`, "INVALID_PANEL_ENTRY_INPUT");
      }
      const field = state[name];
      const source = "frameState" in ref ? frame?.manifest.state[ref.frameState] : undefined;
      if (!field?.external || !("literal" in ref
        ? matchesDirectPanelValue(field.type, ref.literal)
        : source?.external && panelPortAccepts(field.type, source.type))) {
        throw new HttpError(400, `Entry '${use.id}' has incompatible input '${name}'`, "INVALID_PANEL_ENTRY_INPUT");
      }
    }
    if (use.inputs && Object.keys(use.inputs).length) await compile(use.panelId, use.inputs);

    const { defaultAgent } = use;
    if (!defaultAgent || domainId === null) continue;
    if (!definitions) {
      const stored = await assistantStore.agents(domainId);
      const diagnosis = await assistantStore.opsDiagnosis?.(domainId);
      definitions = diagnosis ? [...stored, diagnosis] : stored;
    }
    const unavailable = (reason: "missing" | "disabled" | "missingSkill") => new HttpError(
      409,
      tForLocale(locale, `panels.productCatalog.defaultAgent.${reason}`),
      "PAGE_DEFAULT_AGENT_UNAVAILABLE",
      { useId: use.id },
    );
    const choice = resolveDefaultAgent(definitions, defaultAgent);
    if ("reason" in choice) throw unavailable(choice.reason);

    const ref = panelSkillRef(domainId, use.panelId);
    const key = runtimeSkillKey(ref);
    if (!configuredAssistantSkills(choice.agent, [{ defaultAgent, skills: [ref] }]).some(skill => runtimeSkillKey(skill) === key))
      throw unavailable("missingSkill");
  }
  for (const id of delivery.panels)
    if (!panels.has(id)) throw new HttpError(400, `Panel '${id}' is not reachable from the application`, "INVALID_PANEL_DELIVERY");
  for (const id of delivery.projections)
    if (!projections.has(id)) throw new HttpError(400, `Projection '${id}' is not reachable from the application`, "INVALID_PANEL_DELIVERY");
  await compileRegisteredPanelRoots(client, domainId, pending);
}

function missingApplicationPanel(panelId: string) {
  return new HttpError(400, `Panel '${panelId}' is not a current definition`, "INVALID_PANEL_REFERENCE", { panelId });
}
