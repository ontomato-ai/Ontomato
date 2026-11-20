import { directPanelSchema, productPanelSchema } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { z } from "zod";
import { currentProductRecord } from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { loadCurrentProduct } from "./current";

type ObjectDetailResolution = { kind: "configured"; panelId: string } | { kind: "unconfigured" };
type ObjectDetailPanelMapping = { className: string; panelId: string };

const panelRecordSchema = z.union([directPanelSchema, productPanelSchema]);

async function mappedPanelId(domainId: string, className: string, client: Pick<PoolClient, "query"> = getPostgresPool()) {
  const { rows } = await client.query<{ panelId: string }>(
    `SELECT panel_id AS "panelId" FROM ${t("product_object_details")} WHERE domain_id=$1 AND class_name=$2`,
    [domainId, className],
  );
  return rows[0]?.panelId ?? null;
}

async function requireDetailPanel(domainId: string, panelId: string, client?: PoolClient) {
  const panel = await loadCurrentProduct(domainId, "panel", panelId, client);
  if (!panelRecordSchema.safeParse(currentProductRecord(panel, false)).success)
    throw new HttpError(404, "Mapped detail panel definition is invalid", "PRODUCT_UNAVAILABLE");
}

/** Platform callers resolve the current relation before performing their own resource authorization. */
export async function locateObjectDetailPanel(domainId: string, className: string): Promise<string | null> {
  const panelId = await mappedPanelId(domainId, className);
  if (panelId !== null) await requireDetailPanel(domainId, panelId);
  return panelId;
}

export async function resolveObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string,
): Promise<ObjectDetailResolution> {
  const panelId = await locateObjectDetailPanel(owner.domainId, className);
  if (panelId === null) return { kind: "unconfigured" };
  await requireProductGrant(panelId, "use", credentials);
  return { kind: "configured", panelId };
}

export async function classesUsingDetailPanel(
  domainId: string, panelId: string, client: Pick<PoolClient, "query"> = getPostgresPool(),
): Promise<string[]> {
  const { rows } = await client.query<{ className: string }>(
    `SELECT class_name AS "className" FROM ${t("product_object_details")}
     WHERE domain_id=$1 AND panel_id=$2 ORDER BY class_name`,
    [domainId, panelId],
  );
  return rows.map(({ className }) => className);
}

export async function listObjectDetailPanelMappings(
  domainId: string, client: Pick<PoolClient, "query">,
): Promise<ObjectDetailPanelMapping[]> {
  const { rows } = await client.query<ObjectDetailPanelMapping>(
    `SELECT class_name AS "className", panel_id AS "panelId" FROM ${t("product_object_details")} WHERE domain_id=$1`,
    [domainId],
  );
  return rows;
}
