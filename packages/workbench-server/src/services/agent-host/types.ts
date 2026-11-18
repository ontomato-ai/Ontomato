import type { SessionHistoryQuery } from "@ontomato/contracts/session-history";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { AgentHostCreateSessionResponse, AgentHostSessionPage, AgentHostSessionSnapshot, AgentHostSendResult, AgentHostSendRequest, AgentHostCancelResponse, AgentHostArtifactResolution } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

export interface AgentHostOwner { domainId: string; userId: string }
export type AgentPresentationHost = "workbench" | "observe";
/** The common proxy has two workbench consumers; business actions stay outside it. */
export interface AgentHostService {
  readonly presentationHost?: AgentPresentationHost;
  create(id: string, owner: AgentHostOwner, input: { agentId: string; workspaceId?: string }): Promise<AgentHostCreateSessionResponse>;
  list(owner: AgentHostOwner, input: { agentId: string; limit: number; cursor?: string }): Promise<AgentHostSessionPage>;
  /** The entry's own session read rule, batched; returned IDs are the subset this caller may read. */
  readableSessions(owner: AgentHostOwner, ids: string[]): Promise<Set<string>>;
  history(id: string, owner: AgentHostOwner, query: SessionHistoryQuery): Promise<AgentHostSessionHistory>;
  snapshot(id: string, owner: AgentHostOwner): Promise<AgentHostSessionSnapshot>;
  delete(id: string, owner: AgentHostOwner): Promise<void>;
  rename(id: string, title: string, owner: AgentHostOwner): Promise<void>;
  send(session: string, run: string, input: AgentHostSendRequest, owner: AgentHostOwner, credentials: AssistantCredentials, entry: "human" | "background" | "external"): Promise<AgentHostSendResult>;
  /** Rejects with 404 unless the run belongs to the owner's session, by the host's own records only. */
  ownRun(session: string, run: string, owner: AgentHostOwner): Promise<void>;
  readRun(session: string, run: string, owner: AgentHostOwner): Promise<RuntimeRunSnapshot>;
  cancel(session: string, run: string, owner: AgentHostOwner, credentials: AssistantCredentials): Promise<AgentHostCancelResponse>;
  artifact(session: string, artifact: string, owner: AgentHostOwner): Promise<RuntimeArtifact>;
  content(session: string, artifact: string, owner: AgentHostOwner): Promise<Buffer>;
  resolve(session: string, run: string, path: string, owner: AgentHostOwner): Promise<AgentHostArtifactResolution>;
}
