import { shallowRef } from "vue";
import { applicationCatalogSchema, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { nodeApiRequest } from "@ontomato/workbench-ui";
const applications = shallowRef<CatalogApplication[]>([]);
const error = shallowRef<string | null>(null);
export async function readApplicationCatalog(purpose = "navigation") {
  const response = await nodeApiRequest(`/api/data-query/platform/applications?purpose=${purpose}`, {});
  const body = await response.json();
  if (!body.success) throw new Error(body.message);
  return applicationCatalogSchema.parse(body.data);
}
export function useApplicationCatalog() {
  return { applications, error, async refresh() {
    applications.value = []; error.value = null;
    try { applications.value = await readApplicationCatalog(); }
    catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); }
  } };
}
