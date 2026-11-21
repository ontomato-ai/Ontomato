import { shallowRef } from "vue";
import { applicationCatalogSchema, isPanelApplication, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { panelUsePath } from "@ontomato/contracts/panel-host";
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

/**
 * The built-in application that declares a panel entry at this address and lets this reader open it, as the catalog the
 * shell read lists it (big main's ruling, 2026-11-21: an entry keeps its original address, whatever its prefix); null when
 * none does, or until the catalog is read. It reads the catalog's state, so what calls it again once the catalog arrives.
 */
export function panelEntryApplication(path: string): string | null {
  return applications.value.find((app) => !isPanelApplication(app)
    && (app.panelUses ?? []).some((use) => panelUsePath(use.path) === path))?.id ?? null;
}
