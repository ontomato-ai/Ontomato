import type { Ref } from "vue";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { SubscribePageContext } from "./preview-context";

/** The platform's application catalog, the one its rail draws: the applications this reader may open, read from Java. */
export interface BuilderCatalog {
  readonly applications: Readonly<Ref<readonly CatalogApplication[]>>;
  /** Why the last read failed; null when it did not. */
  readonly error: Readonly<Ref<string | null>>;
  readonly loading: Readonly<Ref<boolean>>;
  /** Reads the catalog again; the rail follows it. */
  refresh(): Promise<void>;
}

/** The edition's permission management, where an administrator grants an application's entry to roles. */
export interface BuilderPermissions {
  /** The page's address in the platform. */
  path: string;
  /** Whether this reader may open it. */
  open: boolean;
}

/** What the platform that shows the builder hands it: facts only the platform holds. */
export interface AppBuilderPlatform {
  /** What the app in the preview reports through the app host. */
  subscribePageContext: SubscribePageContext;
  /** Where a publication shows; read again after publishing or rolling back. */
  catalog: BuilderCatalog;
  /** Opens an application of the catalog by its id, through the same entry as its rail row. */
  openApplication(id: string): void;
  /** null in an edition without permission management (open source). */
  permissions: Readonly<Ref<BuilderPermissions | null>>;
}
