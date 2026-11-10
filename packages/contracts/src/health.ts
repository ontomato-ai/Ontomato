export interface BuildInfo {
  /** The image's build stamp, or local-build when running without build facts. */
  version: string;
  sources: { id: string; revision: string }[];
}

export interface HealthResponse {
  status: "ok";
  timestamp: string;
  build: BuildInfo;
}
