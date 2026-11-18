import type { PoolClient } from "pg";
import { productReferences, type ProductDocument } from "@ontomato/contracts/product-assets";
import type { ProductOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { backendGet, buildBackendHeaders, BackendResponseError } from "../../utils/backend-client";
import { config } from "../../config/application";
import { HttpError } from "../../utils/errors";

export async function assertLegacyApplicationWrite(credentials: AssistantCredentials, applicationId: string) {
  const response = await backendGet("legacy-product-application", config.dataQuery.baseUrl + `/platform/applications/${encodeURIComponent(applicationId)}`,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 })
    .catch(error => { if (error instanceof BackendResponseError && error.status === 404) return null; throw error; });
  // A new legacy draft has no Java application until publication.
  if (response === null) return;
  const application = JSON.parse(response.text);
  if (!application.success) throw new HttpError(400, "Application declaration is unavailable", "PRODUCT_UNAVAILABLE");
  if (application.data.entry.renderer === "panels")
    throw new HttpError(409, "Application is managed by current panels", "APPLICATION_MANAGED_BY_PANELS");
}

/** Current and legacy objects cannot share one product Grant identity. */
export async function assertLegacyProductIdentity(owner: ProductOwner, id: string, client: Pick<PoolClient, "query"> = getPostgresPool()) {
  const current = await client.query(`SELECT id FROM ${t("product_panels")} WHERE domain_id=$1 AND id=$2 UNION ALL SELECT id FROM ${t("product_projections")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  if (current.rows.length) throw new HttpError(409, "Current definitions cannot use legacy product writers", "APPLICATION_MANAGED_BY_PANELS");
}
/** Both stored and proposed compositions count, so removing a link cannot bypass the takeover boundary. */
export async function assertLegacyProductWrite(owner: ProductOwner, credentials: AssistantCredentials,
  target: { id: string; document?: ProductDocument }) {
  const client = getPostgresPool();
  await assertLegacyProductIdentity(owner, target.id, client);
  const stored = await client.query(`SELECT id,document FROM ${t("product_assets")} WHERE domain_id=$1`, [owner.domainId]);
  const bindings = await client.query(`SELECT asset_id,application_id FROM ${t("product_native_application_bindings")} WHERE domain_id=$1`, [owner.domainId]);
  const edges = new Map<string, Set<string>>(), applications = new Map<string, Set<string>>();
  function link(from: string, to: string) {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  }
  function application(assetId: string, applicationId: string) {
    if (!applications.has(assetId)) applications.set(assetId, new Set());
    applications.get(assetId)!.add(applicationId);
  }
  function document(id: string, value: ProductDocument) {
    if (value.kind === "application") application(id, value.applicationId);
    for (const reference of productReferences(value).filter(reference => reference.kind === "asset")) {
      link(id, reference.id); link(reference.id, id);
    }
  }
  for (const row of stored.rows) document(row.id, row.document);
  if (target.document) document(target.id, target.document);
  for (const binding of bindings.rows) application(binding.asset_id, binding.application_id);
  const pending = [target.id], seen = new Set<string>(), affected = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const applicationId of applications.get(id) ?? []) affected.add(applicationId);
    for (const other of edges.get(id) ?? []) pending.push(other);
  }
  for (const applicationId of affected) await assertLegacyApplicationWrite(credentials, applicationId);
}
