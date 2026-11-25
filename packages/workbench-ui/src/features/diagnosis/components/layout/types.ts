import type { RunMeta } from "@ontomato/contracts/autotest";
import type {
  WorkspaceManifest as RemoteWorkspaceManifest,
  ArtifactRetention,
} from "@ontomato/contracts/observe";
// Navigation placeholders have no retention result until their first server response.
export type WorkspaceManifest = RemoteWorkspaceManifest & Partial<ArtifactRetention>;
export type AutotestRunMeta = RunMeta & Partial<ArtifactRetention>;

/** Current account shown in the observe page header (passed by the host; null in open source, so nothing is shown). */
export interface ObserveAccount {
  readonly userName: string;
}
