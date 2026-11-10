import { computed, reactive, shallowRef, watch } from "vue";
import type { ApplicationDeclaration, CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { HostedRelease, WorkspaceCommit } from "@ontomato/contracts/workspaces";
import { workbenchLanguage } from "../../i18n";
import { builderApi } from "./api";
import { errorText } from "./panel";
import type { BuilderCatalog } from "./platform";

/** The rail's icon for the applications the builder publishes. */
const APP_ICON = "pages";

/**
 * A new application's declaration: the name the reader gave, under every language the platform supports, and no
 * permissions of its own. The edition adds the entry permission itself and, on the first publication, grants it to the
 * author.
 */
export function newDeclaration(name: string): ApplicationDeclaration {
  return {
    names: Object.fromEntries(workbenchLanguage().supported.map((locale) => [locale, name])),
    descriptions: {},
    icon: APP_ICON,
    groups: [],
    permissions: [],
  };
}

/**
 * The declaration the application already has in the catalog, to publish another version or roll back under it: a later
 * publication keeps the application's own name, so renaming the workspace never renames the application.
 */
export function catalogDeclaration(app: CatalogApplication): ApplicationDeclaration {
  return { names: app.names, descriptions: app.descriptions, icon: app.icon, groups: [], permissions: [] };
}

/** The application's name as the rail shows it in this language. */
export const applicationName = (app: CatalogApplication, locale: string) => app.names[locale] ?? app.names.en!;

/** A commit with files to publish: every commit but the workspace's first, which is made empty. */
export const publishable = (commit: WorkspaceCommit) => commit.parentIds.length > 0;

/**
 * Where the open workspace's application stands, the one fact the page's header and the publication drawer both show.
 * It puts together the workbench's export records of the workspace (each a release of the workspace's application) and
 * the platform's catalog, the one the rail draws, which alone says whether the application is published and which
 * release it opens. While either is read again, the last answer stays, so neither the header nor the drawer flickers;
 * a read that fails says so, and nothing then counts as published.
 */
export function usePublication(workspaceId: () => string | null, catalog: BuilderCatalog) {
  /** The workspace's exports as last read; null until the first read of this workspace finishes. */
  const releases = shallowRef<HostedRelease[] | null>(null);
  const releasesError = shallowRef<string | null>(null);
  const releasesLoading = shallowRef(false);
  let reads = 0;

  async function loadReleases() {
    const read = ++reads;
    releasesLoading.value = true;
    try {
      const items = await builderApi.releases(workspaceId()!);
      if (read !== reads) return;
      releases.value = items;
      releasesError.value = null;
    } catch (error) {
      if (read === reads) releasesError.value = errorText(error);
    } finally {
      if (read === reads) releasesLoading.value = false;
    }
  }
  // Another workspace has its own application: nothing of the one left stays.
  watch(workspaceId, (id) => {
    reads++;
    releases.value = null;
    releasesError.value = null;
    releasesLoading.value = false;
    if (id) void loadReleases();
  }, { immediate: true });

  const appId = computed(() => releases.value?.[0]?.appId ?? null);
  const application = computed(() => (appId.value && catalog.applications.value.find((app) => app.id === appId.value)) || null);
  /**
   * Exports the catalog does not list are ones Java never took (a rejected first publication), so the next publication
   * names the application as a new one; one that is not listed yet while the catalog is read may still be on its way.
   */
  const status = computed<"loading" | "failed" | "new" | "published">(() => {
    if (releasesError.value) return "failed";
    if (!releases.value) return "loading";
    if (!appId.value) return "new";
    if (catalog.error.value) return "failed";
    if (application.value) return "published";
    return catalog.loading.value ? "loading" : "new";
  });

  return reactive({
    releases,
    /** The application as the catalog lists it, while it is published. */
    application: computed(() => (status.value === "published" ? application.value : null)),
    status,
    failure: computed(() => releasesError.value ?? catalog.error.value),
    /** Whether a read that would settle a failure is under way. */
    retrying: computed(() => releasesLoading.value || catalog.loading.value),
    /** The release the application opens now, by the catalog. */
    currentRelease: computed(() =>
      status.value === "published" ? releases.value!.find((release) => release.releaseId === application.value!.releaseId) ?? null : null,
    ),
    loadReleases,
    retry() {
      if (releasesError.value) void loadReleases();
      else void catalog.refresh();
    },
  });
}

export type Publication = ReturnType<typeof usePublication>;
