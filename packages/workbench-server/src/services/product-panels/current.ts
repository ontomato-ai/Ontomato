import { productPanelSchema, productProjectionSchema, type ProductPanelInput, type ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { currentProductColumns, currentProductRecord, currentProductTables, findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { grantedProductIds, registerProductResource, requireProductGrant } from "../product-governance/grants";
import { notifyProductDefinitionChanged } from "./definition-stream";

async function readable(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string) {
  await requireProductGrant(id, "use", credentials);
  const row = await findCurrentProduct(owner.domainId, kind, id);
  if (!row) throw new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE");
  return row;
}
export async function readCurrentProjection(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const row = await readable(owner, credentials, "projection", id);
  return productProjectionSchema.parse(currentProductRecord(row, (await grantedProductIds("edit", credentials)).includes(id)));
}
export async function readCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string) {
  const row = await readable(owner, credentials, "panel", id);
  return productPanelSchema.parse(currentProductRecord(row, (await grantedProductIds("edit", credentials)).includes(id)));
}

async function validatePanelReferences(owner: ProductOwner, credentials: AssistantCredentials, panel: ProductPanelInput) {
  for (const slot of Object.values(panel.manifest.slots)) {
    const projection = productProjectionSchema.parse(currentProductRecord(await readable(owner, credentials, "projection", slot.projectionId), false));
    for (const [name, ref] of Object.entries(slot.inputs)) {
      const target = projection.inputs[name];
      if (!target) throw new HttpError(400, `Projection has no input: ${name}`, "PANEL_INPUT_UNKNOWN");
      const source = panel.manifest.state[ref.state];
      if (source.kind !== target.kind || (source.kind === "object" && target.kind === "object" ? source.objectType !== target.objectType
        : source.kind === "scalar" && target.kind === "scalar" && source.type !== target.type))
        throw new HttpError(400, `Panel state does not match projection input: ${name}`, "PANEL_INPUT_TYPE_MISMATCH");
    }
  }
}

async function save(owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  input: ProductPanelInput | ProductProjectionInput, revision: number) {
  const existing = await findCurrentProduct(owner.domainId, kind, id);
  if (existing) await requireProductGrant(id, "edit", credentials);
  if ((existing?.revision ?? 0) !== revision) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
  if (kind === "panel") await validatePanelReferences(owner, credentials, input as ProductPanelInput);
  const row = await transaction(async client => {
    await lockProducts(client, owner);
    const table = t(currentProductTables[kind]);
    if (!existing) {
      const other = t(currentProductTables[kind === "panel" ? "projection" : "panel"]);
      const collision = await client.query(`SELECT id FROM ${other} WHERE domain_id=$1 AND id=$2 UNION ALL SELECT id FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
      if (collision.rows.length) throw new HttpError(409, "Product identity already belongs to another collection", "PRODUCT_ID_CONFLICT");
      await registerProductResource(owner, id, input.visibility === "domain");
      await requireProductGrant(id, "edit", credentials);
    }
    const result = revision === 0
      ? await client.query(`INSERT INTO ${table} (domain_id,id,owner_id,definition) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING ${currentProductColumns}`, [owner.domainId, id, owner.userId, JSON.stringify(input)])
      : await client.query(`UPDATE ${table} SET definition=$3::jsonb,revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2 AND revision=$4 RETURNING ${currentProductColumns}`, [owner.domainId, id, JSON.stringify(input), revision]);
    if (!result.rows.length) throw new HttpError(409, "Definition changed; reload before saving", "PRODUCT_CONFLICT");
    return result.rows[0];
  });
  await notifyProductDefinitionChanged({ kind: "definition-changed", domainId: owner.domainId, target: { kind, id } });
  return currentProductRecord(row, true);
}
export async function saveCurrentProjection(owner: ProductOwner, credentials: AssistantCredentials, id: string, input: ProductProjectionInput, revision: number) {
  return productProjectionSchema.parse(await save(owner, credentials, "projection", id, input, revision));
}
export async function saveCurrentPanel(owner: ProductOwner, credentials: AssistantCredentials, id: string, input: ProductPanelInput, revision: number) {
  return productPanelSchema.parse(await save(owner, credentials, "panel", id, input, revision));
}

/** Service-only reference validation for Java; Java checks the registrant's product use Grants. */
export async function requireCurrentPanels(domainId: string, ids: string[]) {
  const result = await getPostgresPool().query(`SELECT id FROM ${t("product_panels")} WHERE domain_id=$1 AND id=ANY($2::text[])`, [domainId, ids]);
  const found = new Set(result.rows.map(row => row.id));
  if (ids.some(id => !found.has(id))) throw new HttpError(400, "Use relations require current panel IDs", "INVALID_PANEL_REFERENCE");
}
