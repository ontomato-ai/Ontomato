import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  type DomainComponentInput, type registerDomainComponentRequestSchema, type updateDomainComponentRequestSchema,
} from "@ontomato/contracts/domain-components";
import { checkAuthoringDirectApiCalls, componentModuleImports, readModuleFacts } from "@ontomato/contracts/panel-module";
import { DOMAIN_COMPONENT_PREFIX } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { currentProductColumns, findCurrentProducts, type CurrentProductRow } from "../../infrastructure/product-current";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { transaction } from "../../infrastructure/postgres-transaction";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { requireAllowed, requireObject, retireObject, writeFirstPublication } from "../product-governance/authorization";
import { currentDefinition, currentDefinitionAccess } from "../product-panels/access";
import { declarationChanges, findComponentUsers } from "../product-panels/component-users";
import { productReferenceKey } from "../product-panels/references";
import { domainComponentRecord, findDomainComponent, listVisibleDomainComponents } from "./store";

const unavailable = () => new HttpError(404, "Component is unavailable in this domain", "COMPONENT_UNAVAILABLE");

export async function listDomainComponents(owner: ProductOwner, credentials: AssistantCredentials) {
  return listVisibleDomainComponents(owner.domainId, credentials);
}

export async function readDomainComponent(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const row = await findDomainComponent(owner.domainId, id);
  if (!row) throw unavailable();
  const { decisions, editable } = await currentDefinitionAccess("component", [row], owner.domainId, credentials);
  requireAllowed(decisions[0]);
  return domainComponentRecord(row, editable.has(id));
}

export async function checkDomainComponentSource({ source }: DomainComponentInput) {
  if (source.module === undefined) return;
  try {
    await componentModuleImports(source.module, { allowRelative: false });
    const directApiViolations = checkAuthoringDirectApiCalls(source.module, "source.module");
    if (directApiViolations.length > 0) throw new Error(directApiViolations[0]!.message);
    const { exports } = await readModuleFacts(source.module);
    if (!exports.some(entry => "name" in entry && entry.name === "default")) throw new Error("The module must export a Vue component as default");
  } catch (cause) {
    throw new HttpError(400, `field 'source.module': ${cause instanceof Error ? cause.message : String(cause)}`, "INVALID_REQUEST");
  }
}

export async function registerDomainComponent(
  owner: ProductOwner, credentials: AssistantCredentials, request: z.infer<typeof registerDomainComponentRequestSchema>,
) {
  await requireObject({ create: "COMPONENT" }, credentials);
  const { publicationAccess, ...definition } = request;
  const id = definition.declaration.componentId ?? DOMAIN_COMPONENT_PREFIX + randomUUID();
  const input = { ...definition, declaration: { ...definition.declaration, componentId: id } };
  await checkDomainComponentSource(input);
  return transaction(async client => {
    await lockProducts(client, owner);
    const { rows: collisions } = await client.query(
      `SELECT id FROM ${t("domain_components")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT id FROM ${t("product_projections")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT id FROM ${t("product_panels")} WHERE domain_id=$1 AND id=$2 LIMIT 1`,
      [owner.domainId, id],
    );
    if (collisions.length) throw new HttpError(409, "Component ID already belongs to a current definition", "PRODUCT_ID_CONFLICT");
    const { rows } = await client.query<CurrentProductRow>(
      `INSERT INTO ${t("domain_components")} (domain_id,id,owner_id,definition)
       VALUES ($1,$2,$3,$4::jsonb) RETURNING ${currentProductColumns}`, [owner.domainId, id, owner.userId, JSON.stringify(input)],
    );
    const row = rows[0]!;
    const object = currentDefinition("component", row, owner.domainId);
    await writeFirstPublication({ ...object, ownerFacts: { ...object.ownerFacts, state: "DRAFT" } }, publicationAccess, credentials);
    return domainComponentRecord(row, true);
  });
}

async function currentForChange(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials, id: string, revision: number) {
  await lockProducts(client, owner);
  const row = await findDomainComponent(owner.domainId, id, client);
  if (!row) throw unavailable();
  await requireObject({ ...currentDefinition("component", row, owner.domainId), verb: "EDIT" }, credentials);
  if (row.revision !== revision) throw new HttpError(409, "Definition changed; reload before editing", "PRODUCT_CONFLICT");
  return row;
}

async function visibleUsage(
  { rows, users, directPanels }: Awaited<ReturnType<typeof findComponentUsers>>,
  domainId: string, credentials: AssistantCredentials, client: PoolClient,
) {
  const panels = new Map<string, { domainId: string | null; id: string }>(
    rows.flatMap(row => [...users.get(productReferenceKey(row))?.entries() ?? []]),
  );
  for (const panel of directPanels) {
    panels.set(productReferenceKey(panel), panel);
  }
  const [projections, panelRows] = await Promise.all([
    findCurrentProducts(domainId, "projection", rows.map(({ id }) => id), client),
    findCurrentProducts(domainId, "panel", [...panels.values()].filter(panel => panel.domainId === null || panel.domainId === domainId).map(({ id }) => id), client),
  ]);
  const projectionFacts = [...projections.values()];
  const panelFacts = [...panelRows.values()];
  const [projectionAccess, panelAccess] = await Promise.all([
    currentDefinitionAccess("projection", projectionFacts, domainId, credentials, false),
    currentDefinitionAccess("panel", panelFacts, domainId, credentials, false),
  ]);
  const visibleProjections = projectionFacts.filter((_, index) => projectionAccess.decisions[index].allowed).map(({ id }) => ({ id }));
  const visiblePanels = panelFacts.filter((_, index) => panelAccess.decisions[index].allowed).map(({ id }) => ({ id }));
  return {
    projections: visibleProjections,
    panels: visiblePanels,
    hiddenProjectionCount: rows.length - visibleProjections.length,
    hiddenPanelCount: panels.size - visiblePanels.length,
  };
}

export async function domainComponentUsedBy(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  await readDomainComponent(owner, credentials, id);
  return transaction(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return visibleUsage(await findComponentUsers([id], client, owner.domainId), owner.domainId, credentials, client);
  });
}

export async function updateDomainComponent(
  owner: ProductOwner, credentials: AssistantCredentials, id: string, { revision, ...input }: z.infer<typeof updateDomainComponentRequestSchema>,
) {
  if (input.declaration.componentId !== id)
    throw new HttpError(400, "field 'declaration.componentId' must match the component being updated", "INVALID_REQUEST");
  await checkDomainComponentSource(input);
  return transaction(async client => {
    const current = domainComponentRecord(await currentForChange(client, owner, credentials, id, revision), true);
    if (!isDeepStrictEqual(current.declaration, input.declaration)) {
      const usage = await findComponentUsers([id], client, owner.domainId);
      const changes = usage.rows.flatMap(row => {
        const panels = usage.users.get(productReferenceKey(row))?.values() ?? [];
        return declarationChanges(row.definition, current.declaration, input.declaration, panels);
      });
      if (changes.length) throw new HttpError(409, "Component declaration changes fields that are in use", "COMPONENT_INCOMPATIBLE", {
        ...await visibleUsage(usage, owner.domainId, credentials, client), fields: [...new Set(changes.map(change => change.field))],
      });
    }
    const { rows } = await client.query<CurrentProductRow>(
      `UPDATE ${t("domain_components")} SET definition=$3::jsonb,revision=revision+1,updated_at=now()
       WHERE domain_id=$1 AND id=$2 RETURNING ${currentProductColumns}`,
      [owner.domainId, id, JSON.stringify(input)],
    );
    return domainComponentRecord(rows[0]!, true);
  });
}

export async function deleteDomainComponent(owner: ProductOwner, credentials: AssistantCredentials, id: string, revision: number) {
  return transaction(async client => {
    const row = await currentForChange(client, owner, credentials, id, revision);
    const usage = await findComponentUsers([id], client, owner.domainId);
    if (usage.rows.length || usage.directPanels.length)
      throw new HttpError(409, "Component is in use", "COMPONENT_IN_USE", await visibleUsage(usage, owner.domainId, credentials, client));
    await retireObject(currentDefinition("component", row, owner.domainId), credentials);
    await client.query(`DELETE FROM ${t("domain_components")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  });
}
