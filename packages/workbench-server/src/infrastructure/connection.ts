import type { RegisterProductAssetGrant } from "./postgres-migrations/20261125-product-asset-grants/migration";
import { initializePostgres, closePostgres } from "./postgres";
let initialized = false;
export async function initializeConnection(registerProductAssetGrant: RegisterProductAssetGrant) {
  if (!initialized) {
    await initializePostgres(registerProductAssetGrant);
    initialized = true;
  }
}
export async function closeConnection() {
  await closePostgres();
  initialized = false;
}
