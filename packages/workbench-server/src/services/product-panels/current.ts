import { themeOverrideProblems } from "@ontomato/design-tokens/theme-overrides";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import {
  METRIC_CHART_COMPONENT, builtinProductPanelInputSchema, chartProjectionSchema, productPanelInputSchema, productPanelSchema, productProjectionSchema,
  type ApplicationPanelReferencesRequest, type ProductPanel,
  type ProductPanelInput, type ProductProjectionInput, type RegisterProductProjectionRequest,
} from "@ontomato/contracts/product-panels";
import { domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import { matchesDirectPanelValue, panelPortAccepts } from "@ontomato/contracts/panel-manifest";
import type { PoolClient } from "pg";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { currentProductColumns, currentProductRecord, currentProductTables, findCurrentProduct, type CurrentProductKind, type CurrentProductRow } from "../../infrastructure/product-current";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { grantedProductIds, registerProductResource, requireProductGrant } from "../product-governance/grants";
import { assertAppBuilderAccess } from "../app-builder/access";
import { notifyProductDefinitionChanged } from "./definition-stream";
import { assistantStore } from "../assistant/store";
import { configuredAssistantSkills } from "../assistant/skill-selection";
import { resolveDefaultAgent } from "../assistant/default-agents";
import { panelSkillRef } from "./skill-identity";
import { findPanelUsers, validateCurrentProductReferences } from "./references";
import { validateProjectionComponent } from "./component-catalogue";
import { parseStoredDefinition } from "./definition-diagnostics";

type CurrentDefinition = ProductPanelInput | ProductProjectionInput;

export async function loadCurrentProduct(domainId: string, kind: CurrentProductKind, id: string, client?: PoolClient) {
  const row = await findCurrentProduct(domainId, kind, id, client);
  if (!row) throw new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE");
  return row;
}

export async function requireCurrentProduct(owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string, verb: "use" | "edit", client?: PoolClient) {
  await requireProductGrant(id, verb, credentials);
  return loadCurrentProduct(owner.domainId, kind, id, client);
}

export function requireOrdinaryProjection(input: Pick<ProductProjectionInput, "componentId">) {
  if (input.componentId === METRIC_CHART_COMPONENT)
    throw new HttpError(400, "Register a chart through its source card", "CHART_SOURCE_REGISTRATION_REQUIRED");
}
async function readCurrentRecord(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string, reportMissingToAuthor: boolean,
) {
  const row = reportMissingToAuthor
    ? await findCurrentProduct(owner.domainId, kind, id)
    : await requireCurrentProduct(owner, credentials, kind, id, "use");
  if (!row) {
    await assertAppBuilderAccess(credentials);
    throw new HttpError(404, `${kind === "panel" ? "Panel" : "Projection"} '${id}' does not exist`, "PRODUCT_UNAVAILABLE");
  }
  const managePanel = reportMissingToAuthor && kind === "panel";
  if (reportMissingToAuthor && !managePanel) await requireProductGrant(id, "use", credentials);
  const editable = row.domainId !== null && (await grantedProductIds("edit", credentials)).includes(id);
  if (managePanel && row.ownerId !== owner.userId && !editable)
    await requireProductGrant(id, "use", credentials);
  return currentProductRecord(row, editable);
}
export async function readCurrentProjection(owner: ProductOwner, credentials: AssistantCredentials, id: string, reportMissingToAuthor = false) {
  return productProjectionSchema.parse(await readCurrentRecord(owner, credentials, "projection", id, reportMissingToAuthor));
}
export async function readCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string, reportMissingToAuthor = false) {
  const record = await readCurrentRecord(owner, credentials, "panel", id, reportMissingToAuthor);
  return parseStoredDefinition(productPanelSchema, record, "Panel");
}

export async function readCurrentPanelLabel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const record = await readCurrentRecord(owner, credentials, "panel", id, true);
  const parsed = productPanelInputSchema.pick({ name: true }).safeParse(record);
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
  if (existing) await requireProductGrant(id, "edit", credentials);
  if ((existing?.revision ?? 0) !== revision) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
  return existing;
}

export async function insertCurrentProduct(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials,
  kind: CurrentProductKind, id: string, input: CurrentDefinition): Promise<CurrentProductRow> {
  domainProductIdSchema.parse(id);
  const other = t(currentProductTables[kind === "panel" ? "projection" : "panel"]);
  const collision = await client.query(
    `SELECT id FROM ${other} WHERE domain_id=$1 AND id=$2
     UNION ALL SELECT id FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2
     UNION ALL SELECT asset_id FROM ${t("product_asset_revisions")} WHERE domain_id=$1 AND asset_id=$2 LIMIT 1`,
    [owner.domainId, id],
  );
  if (collision.rows.length) throw new HttpError(409, "Product identity already belongs to another collection", "PRODUCT_ID_CONFLICT");
  if ("componentId" in input) await validateProjectionComponent(id, input);
  await registerProductResource(owner, id, input.visibility === "domain");
  await requireProductGrant(id, "edit", credentials);
  const result = await client.query(`INSERT INTO ${t(currentProductTables[kind])} (domain_id,id,owner_id,definition) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING ${currentProductColumns}`, [owner.domainId, id, owner.userId, JSON.stringify(input)]);
  if (!result.rows.length) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
  return result.rows[0];
}

async function save(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  input: CurrentDefinition, revision: number, solePanelId?: string) {
  if (revision !== 0 && "componentId" in input) await validateProjectionComponent(id, input);
  const row = await transaction(async client => {
    await lockProducts(client, owner);
    if (solePanelId !== undefined) {
      const users = await findPanelUsers(owner.domainId, "projection", id, client);
      if (users.length !== 1 || users[0]!.id !== solePanelId)
        throw new HttpError(409, "The projection's referencing panels changed. Register again to check its current uses.", "PROJECTION_REUSE_CONFLICT");
    }
    await validateCurrentProductReferences(owner, credentials, kind, id, input, client);
    if (revision === 0) return insertCurrentProduct(client, owner, credentials, kind, id, input);
    const result = await client.query(`UPDATE ${t(currentProductTables[kind])} SET definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2 AND revision=$4 RETURNING ${currentProductColumns}`, [owner.domainId, id, JSON.stringify(input), revision]);
    if (!result.rows.length) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
    return result.rows[0];
  });
  await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind, id } });
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
  const { revision, ...input } = request;
  requireOrdinaryProjection(input);
  return productProjectionSchema.parse(await save(owner, credentials, "projection", id, input, revision, solePanelId));
}

export async function saveCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string, input: ProductPanelInput, revision: number) {
  await currentForSave(owner, credentials, "panel", id, revision);
  return productPanelSchema.parse(await save(owner, credentials, "panel", id, input, revision));
}

/** Java authorizes the registrant. This service call checks the current definitions used by the declaration. */
export async function validateApplicationPanelReferences(request: ApplicationPanelReferencesRequest) {
  const { domainId, framePanelId, uses, delivery, theme } = request;
  if (theme) {
    const [issue] = themeOverrideProblems(theme);
    if (issue) {
      throw new HttpError(400, `Application theme '${issue.mode}.${issue.name}': ${issue.message}`, "INVALID_PANEL_THEME");
    }
  }
  const panels = new Map<string, Pick<ProductPanel, "manifest">>();
  const projections = new Set<string>();
  const pending = new Set(uses.map(use => use.panelId));
  if (framePanelId !== undefined) pending.add(framePanelId);
  for (const panelId of pending) {
    const row = await findCurrentProduct(domainId, "panel", panelId);
    if (!row) throw new HttpError(400, `Panel '${panelId}' is not a current definition`, "INVALID_PANEL_REFERENCE");
    const panel = (row.domainId === null ? builtinProductPanelInputSchema : productPanelInputSchema).parse(row.definition);
    panels.set(panelId, panel);
    for (const { target } of Object.values(panel.manifest.members)) {
      if ("panelId" in target) pending.add(target.panelId);
      if ("projectionId" in target) projections.add(target.projectionId);
    }
  }
  await Promise.all([...projections].map(id => loadCurrentProduct(domainId, "projection", id)));

  const frame = framePanelId === undefined ? undefined : panels.get(framePanelId)!;
  let definitions: Awaited<ReturnType<typeof assistantStore.agents>> | undefined;
  for (const use of uses) {
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

    const { defaultAgent } = use;
    if (!defaultAgent) continue;
    definitions ??= await assistantStore.agents(domainId);
    const selection = defaultAgent.kind === "id" ? `'${defaultAgent.id}'` : `preset '${defaultAgent.agentKind}'`;
    const unavailable = (reason: string) =>
      new HttpError(409, `Entry '${use.id}' default agent ${selection} ${reason}`, "PAGE_DEFAULT_AGENT_UNAVAILABLE");
    const choice = resolveDefaultAgent(definitions, defaultAgent);
    if ("reason" in choice) throw unavailable(choice.reason);

    const ref = panelSkillRef(domainId, use.panelId);
    const key = runtimeSkillKey(ref);
    if (!configuredAssistantSkills(choice.agent, [ref]).some(skill => runtimeSkillKey(skill) === key))
      throw unavailable(`does not select the skill for panel '${use.panelId}'.`);
  }
  for (const id of delivery.panels)
    if (!panels.has(id)) throw new HttpError(400, `Panel '${id}' is not reachable from the application`, "INVALID_PANEL_DELIVERY");
  for (const id of delivery.projections)
    if (!projections.has(id)) throw new HttpError(400, `Projection '${id}' is not reachable from the application`, "INVALID_PANEL_DELIVERY");
}
