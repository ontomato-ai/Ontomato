import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";

export type DashboardDatasetInput = Partial<ResultTruncation> & {
  datasetKey: string;
  subQuestion: string;
  data: Array<Record<string, unknown>>;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  source?: {
    sessionId: string;
    artifactId: string;
  };
};
