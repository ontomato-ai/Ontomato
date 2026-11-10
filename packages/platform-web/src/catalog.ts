import { shallowRef } from "vue";
import { applicationCatalogSchema, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { nodeApiRequest } from "@ontomato/workbench-ui";
const applications = shallowRef<CatalogApplication[]>([]);
const error = shallowRef<string | null>(null);
const loading = shallowRef(true);
export async function readApplicationCatalog(purpose = "navigation") {
  const response = await nodeApiRequest(`/api/data-query/platform/applications?purpose=${purpose}`, {});
  const body = await response.json();
  if (!body.success) throw new Error(body.message);
  return applicationCatalogSchema.parse(body.data);
}
/**
 * The applications this reader may open, as the rail shows them. The list and the error are those of the last read that
 * finished: while the catalog is read again (after a publication, a rollback, another navigation) both stay, so the rail
 * never empties and fills up again, and the new list replaces the old one whole. A read that fails reports its error and
 * keeps the list there was.
 */
export function useApplicationCatalog() {
  return { applications, error, loading, async refresh() {
    loading.value = true;
    try {
      applications.value = await readApplicationCatalog();
      error.value = null;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      loading.value = false;
    }
  } };
}
