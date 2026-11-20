import { assertPermission } from "../../identity/installed";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { findObjectDetailPanelId, requireDetailPanel } from "./object-detail";
import { validateObjectDetailPanelMapping } from "./references";

async function writeObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string, panelId: string | null,
): Promise<void> {
  await assertPermission(credentials, ["ontology-modeling"]);
  await transaction(async client => {
    await lockProducts(client, owner);
    const currentPanelId = await findObjectDetailPanelId(owner.domainId, className, client);
    if (currentPanelId !== null) await requireProductGrant(currentPanelId, "edit", credentials);
    if (panelId === null) {
      await client.query(`DELETE FROM ${t("product_object_details")} WHERE domain_id=$1 AND class_name=$2`,
        [owner.domainId, className]);
      return;
    }
    await requireDetailPanel(owner.domainId, panelId, client);
    await requireProductGrant(panelId, "use", credentials);
    await validateObjectDetailPanelMapping(owner.domainId, className, panelId, client);
    await client.query(`INSERT INTO ${t("product_object_details")} (domain_id,class_name,panel_id,updated_by)
      VALUES ($1,$2,$3,$4) ON CONFLICT (domain_id,class_name) DO UPDATE
      SET panel_id=EXCLUDED.panel_id,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [owner.domainId, className, panelId, owner.userId]);
  });
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
