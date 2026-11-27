import { productPanelSchema } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { currentProductRecord, findCurrentProduct } from "../../infrastructure/product-current";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { requireCurrentDefinitionUse } from "./access";

type ObjectDetailResolution = { kind: "configured"; panelId: string } | { kind: "unconfigured" };
type ObjectDetailPanelMapping = { className: string; panelId: string };

export async function findObjectDetailPanelId(domainId: string, className: string, client: Pick<PoolClient, "query"> = getPostgresPool()) {
  const { rows } = await client.query<{ panelId: string }>(
    `SELECT panel_id AS "panelId" FROM ${t("product_object_details")} WHERE domain_id=$1 AND class_name=$2`,
    [domainId, className],
  );
  return rows[0]?.panelId ?? null;
}

export async function findDetailPanel(domainId: string, panelId: string, client?: PoolClient) {
  const panel = await findCurrentProduct(domainId, "panel", panelId, client);
  if (!panel) return { status: "missing" } as const;
  const parsed = productPanelSchema.safeParse(currentProductRecord(panel, false));
  if (!parsed.success) return { status: "invalid" } as const;
  return { status: "available", panel: parsed.data } as const;
}

export async function requireDetailPanel(domainId: string, panelId: string, client?: PoolClient) {
  const result = await findDetailPanel(domainId, panelId, client);
  if (result.status === "missing") throw new HttpError(404, "Mapped detail panel does not exist", "PRODUCT_NOT_FOUND");
  if (result.status === "invalid") throw new HttpError(404, "Mapped detail panel definition is invalid", "PRODUCT_UNAVAILABLE");
  return result.panel;
}

export async function resolveObjectDetail(
  owner: ProductOwner, credentials: AssistantCredentials, className: string,
): Promise<ObjectDetailResolution> {
  const panelId = await findObjectDetailPanelId(owner.domainId, className);
  if (panelId === null) return { kind: "unconfigured" };
  const panel = await requireDetailPanel(owner.domainId, panelId);
  await requireCurrentDefinitionUse("panel", panel, owner.domainId, credentials);
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
