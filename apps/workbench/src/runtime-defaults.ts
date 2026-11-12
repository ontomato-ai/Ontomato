import type { RuntimeDefaults } from "@ontomato/workbench-server";

/** The OSS edition's historical local defaults. Used when DATABASE_URL is unset. */
export const ossRuntimeDefaults: RuntimeDefaults = {
  postgresFallback: "postgresql://ontomato:ontomato@localhost:5432/ontomato",
  /** The OSS edition's historical default request locale. */
  requestLocaleFallback: "en",
};

