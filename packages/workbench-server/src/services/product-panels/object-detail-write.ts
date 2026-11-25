import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { findObjectDetailPanelId, requireDetailPanel } from "./object-detail";
import { validateObjectDetailPanelMapping } from "./references";
import { compileRegisteredPanelRoots, queueDependencyPublication } from "./entry-dependency-store";
import { deliverEntryDependencyPublications } from "./entry-dependency-publication";

async function writeObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string, panelId: string | null,
): Promise<void> {
  await assertManagement(workbenchManagement.objectDetailsChange, owner, credentials);
  await transaction(async client => {
    await lockProducts(client, owner);
    const source = { kind: "object-detail" as const, id: className, actorId: owner.userId };
    if (panelId === null) {
      const { rows } = await client.query<{ panel_id: string }>(`DELETE FROM ${t("product_object_details")} WHERE domain_id=$1 AND class_name=$2 RETURNING panel_id`,
        [owner.domainId, className]);
      if (rows.length) await queueDependencyPublication(client, owner.domainId, {
        source, panels: [], detail: { before: rows[0].panel_id, after: null },
      });
      return;
    }
    await requireDetailPanel(owner.domainId, panelId, client);
    await requireProductGrant(panelId, "use", credentials);
    await validateObjectDetailPanelMapping(owner.domainId, className, panelId, client);
    const before = await findObjectDetailPanelId(owner.domainId, className, client);
    await compileRegisteredPanelRoots(client, owner.domainId, [panelId]);
    await client.query(`INSERT INTO ${t("product_object_details")} (domain_id,class_name,panel_id,updated_by)
      VALUES ($1,$2,$3,$4) ON CONFLICT (domain_id,class_name) DO UPDATE
      SET panel_id=EXCLUDED.panel_id,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [owner.domainId, className, panelId, owner.userId]);
    if (before !== panelId) await queueDependencyPublication(client, owner.domainId, {
      source, panels: [], detail: { before, after: panelId },
    });
  });
  await deliverEntryDependencyPublications(owner.domainId);
}

export async function setObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string, panelId: string,
): Promise<void> {
  await writeObjectDetail(owner, credentials, className, panelId);
}

export async function clearObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string,
): Promise<void> {
  await writeObjectDetail(owner, credentials, className, null);
}
