import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import type { DatasetPayload } from "@ontomato/contracts/data-retrieval";

export type DashboardDatasetInput = Partial<ResultTruncation> & {
  datasetKey: string;
  subQuestion: string;
  data: Array<Record<string, unknown>>;
  recipe: DatasetPayload["recipe"];
  columns: DatasetPayload["columns"];
  source?: {
    sessionId: string;
    artifactId: string;
  };
};
