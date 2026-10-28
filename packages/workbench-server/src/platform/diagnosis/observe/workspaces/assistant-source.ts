import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";

export interface DiagnosticTurnTimes {
  status: string;
  startedAt: Date;
  endedAt?: Date;
  updatedAt: Date;
}
export interface DiagnosticQueryEvidence {
  sourceRef: string;
  question?: string;
  fullContent?: string;
  backendSessions?: QueryBackendSession[];
}
export interface DiagnosticAssistantEvidence {
  question: string;
  answer: string;
  retrievalRequested: boolean;
  runs: RuntimeRunSnapshot[];
  queries: DiagnosticQueryEvidence[];
  turnRun: DiagnosticTurnTimes;
}
export interface AssistantEvidenceReader {
  readTurn(
    sessionId: string,
    requestSeq: number,
    access: { domainId: string; scope: "domain" },
  ): Promise<DiagnosticAssistantEvidence>;
  verifyDomain(sessionId: string, domainId: string): Promise<void>;
}
let installed: AssistantEvidenceReader | undefined;
/** The HTTP application supplies the business owner; diagnosis never imports a business store. */
export function installAssistantEvidenceReader(
  reader: AssistantEvidenceReader,
) {
  installed = reader;
}
export function assistantEvidenceReader() {
  if (!installed) throw new Error("Assistant evidence reader is not installed");
  return installed;
}
