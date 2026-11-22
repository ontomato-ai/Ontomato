import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  type DomainComponentInput, type registerDomainComponentRequestSchema, type updateDomainComponentRequestSchema,
} from "@ontomato/contracts/domain-components";
import { panelModuleImports, readModuleFacts } from "@ontomato/contracts/panel-module";
import { DOMAIN_COMPONENT_PREFIX } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { currentProductColumns, type CurrentProductRow } from "../../infrastructure/product-current";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { transaction } from "../../infrastructure/postgres-transaction";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assertAppBuilderAccess } from "../app-builder/access";
import {
  grantedProductIds, registerProductResource, requireProductGrant, unregisterProductResource, type ProductOwner,
} from "../product-governance/grants";
import { declarationChanges, findComponentUsers } from "../product-panels/component-users";
import { productReferenceKey } from "../product-panels/references";
import { domainComponentRecord, findDomainComponent, listVisibleDomainComponents } from "./store";

const unavailable = () => new HttpError(404, "Component is unavailable in this domain", "COMPONENT_UNAVAILABLE");

export async function listDomainComponents(owner: ProductOwner, credentials: AssistantCredentials) {
  await assertAppBuilderAccess(credentials);
  const editable = new Set(await grantedProductIds("edit", credentials));
  return listVisibleDomainComponents(owner.domainId, owner.userId, editable);
}

export async function readDomainComponent(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  await assertAppBuilderAccess(credentials);
  const row = await findDomainComponent(owner.domainId, id);
  if (!row) throw unavailable();
  const editable = (await grantedProductIds("edit", credentials)).includes(id);
  const record = domainComponentRecord(row, editable);
  if (!editable && row.ownerId !== owner.userId && record.visibility !== "domain") throw unavailable();
  return record;
}

async function checkSource({ source }: DomainComponentInput) {
  if (source.module === undefined) return;
  try {
    await panelModuleImports(source.module);
    const { exports } = await readModuleFacts(source.module);
    if (!exports.some(entry => "name" in entry && entry.name === "default")) throw new Error("The module must export a Vue component as default");
  } catch (cause) {
    throw new HttpError(400, `field 'source.module': ${cause instanceof Error ? cause.message : String(cause)}`, "INVALID_REQUEST");
  }
}

export async function registerDomainComponent(
  owner: ProductOwner, credentials: AssistantCredentials, request: z.infer<typeof registerDomainComponentRequestSchema>,
) {
  await assertAppBuilderAccess(credentials);
  const id = request.declaration.componentId ?? DOMAIN_COMPONENT_PREFIX + randomUUID();
  const input = { ...request, declaration: { ...request.declaration, componentId: id } };
  await checkSource(input);
  return transaction(async client => {
    await lockProducts(client, owner);
    const { rows: collisions } = await client.query(
      `SELECT id FROM ${t("domain_components")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT id FROM ${t("product_projections")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT id FROM ${t("product_panels")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT id FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2
       UNION ALL SELECT asset_id FROM ${t("product_asset_revisions")} WHERE domain_id=$1 AND asset_id=$2 LIMIT 1`,
      [owner.domainId, id],
    );
    if (collisions.length) throw new HttpError(409, "Component ID already belongs to a current definition", "PRODUCT_ID_CONFLICT");
    const { rows } = await client.query<CurrentProductRow>(
      `INSERT INTO ${t("domain_components")} (domain_id,id,owner_id,definition)
       VALUES ($1,$2,$3,$4::jsonb) RETURNING ${currentProductColumns}`, [owner.domainId, id, owner.userId, JSON.stringify(input)],
    );
    await registerProductResource(owner, id, false);
    return domainComponentRecord(rows[0]!, true);
  });
}

async function currentForChange(client: PoolClient, owner: ProductOwner, credentials: AssistantCredentials, id: string, revision: number) {
  await lockProducts(client, owner);
  const row = await findDomainComponent(owner.domainId, id, client);
  if (!row) throw unavailable();
  await requireProductGrant(id, "edit", credentials);
  if (row.revision !== revision) throw new HttpError(409, "Definition changed; reload before editing", "PRODUCT_CONFLICT");
  return domainComponentRecord(row, true);
}

async function visibleUsage(
  { rows, users }: Awaited<ReturnType<typeof findComponentUsers>>, credentials: AssistantCredentials,
) {
  const panels = new Map(rows.flatMap(row => [...users.get(productReferenceKey(row))?.entries() ?? []]));
  const visible = new Set(await grantedProductIds("use", credentials));
  const visibleProjections = rows.filter(row => visible.has(row.id)).map(({ id }) => ({ id }));
  const visiblePanels = [...panels.values()].filter(panel => panel.domainId === null || visible.has(panel.id)).map(({ id }) => ({ id }));
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
    return visibleUsage(await findComponentUsers([id], client, owner.domainId), credentials);
  });
}

export async function updateDomainComponent(
  owner: ProductOwner, credentials: AssistantCredentials, id: string, { revision, ...input }: z.infer<typeof updateDomainComponentRequestSchema>,
) {
  if (input.declaration.componentId !== id)
    throw new HttpError(400, "field 'declaration.componentId' must match the component being updated", "INVALID_REQUEST");
  await checkSource(input);
  return transaction(async client => {
    const current = await currentForChange(client, owner, credentials, id, revision);
    if (!isDeepStrictEqual(current.declaration, input.declaration)) {
      const usage = await findComponentUsers([id], client, owner.domainId);
      const changes = usage.rows.flatMap(row => {
        const panels = usage.users.get(productReferenceKey(row))?.values() ?? [];
        return declarationChanges(row.definition, current.declaration, input.declaration, panels);
      });
      if (changes.length) throw new HttpError(409, "Component declaration changes fields that are in use", "COMPONENT_INCOMPATIBLE", {
        ...await visibleUsage(usage, credentials), fields: [...new Set(changes.map(change => change.field))],
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
    await currentForChange(client, owner, credentials, id, revision);
    const usage = await findComponentUsers([id], client, owner.domainId);
    if (usage.rows.length)
      throw new HttpError(409, "Component is in use", "COMPONENT_IN_USE", await visibleUsage(usage, credentials));
    await unregisterProductResource(owner.domainId, id);
    await client.query(`DELETE FROM ${t("domain_components")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  });
}
