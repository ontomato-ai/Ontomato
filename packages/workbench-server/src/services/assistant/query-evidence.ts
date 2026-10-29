import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";

/** Read-only retrieval evidence for the existing diagnosis consumers. */
export interface AssistantQueryEvidence {
  id: string;
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
  question: string;
  status: RuntimeRunSnapshot["run"]["status"];
  backendSessions: QueryBackendSession[];
  datasetsPayload: Array<{
    id: string;
    datasetKey: string;
    title: string;
    rows: Record<string, unknown>[];
    dsl?: unknown;
    abcProgram?: AbcProgramDashboard;
  } & Partial<ResultTruncation>>;
  fullContent: string;
  qcResult?: any;
  objectClasses: string[];
  dataCount: number;
  createdAt: Date;
  updatedAt: Date;
}
