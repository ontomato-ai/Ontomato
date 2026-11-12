import type { SessionHistoryQuery } from "@ontomato/contracts/session-history";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { AgentHostAgentList, AgentHostCreateSessionResponse, AgentHostSessionPage, AgentHostSessionSnapshot, AgentHostAdmission, AgentHostCancelResponse, AgentHostArtifactResolution } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

export interface AgentHostOwner { domainId: string; userId: string }
/** The common proxy has two workbench consumers; business actions stay outside it. */
export interface AgentHostService {
  agents(owner: AgentHostOwner, locale?: string): Promise<AgentHostAgentList>;
  create(id: string, owner: AgentHostOwner, input: { agentId: string; workspaceId?: string }): Promise<AgentHostCreateSessionResponse>;
  list(owner: AgentHostOwner, input: { agentId: string; limit: number; cursor?: string }): Promise<AgentHostSessionPage>;
  /** The entry's own session read rule: false when the caller may not read it; storage errors propagate. */
  canReadSession(owner: AgentHostOwner, id: string): Promise<boolean>;
  history(id: string, owner: AgentHostOwner, query: SessionHistoryQuery): Promise<AgentHostSessionHistory>;
  snapshot(id: string, owner: AgentHostOwner): Promise<AgentHostSessionSnapshot>;
  delete(id: string, owner: AgentHostOwner): Promise<void>;
  rename(id: string, title: string, owner: AgentHostOwner): Promise<void>;
  start(session: string, run: string, message: string, owner: AgentHostOwner, credentials: AssistantCredentials): Promise<AgentHostAdmission>;
  /** Rejects with 404 unless the run belongs to the owner's session, by the host's own records only. */
  ownRun(session: string, run: string, owner: AgentHostOwner): Promise<void>;
  readRun(session: string, run: string, owner: AgentHostOwner): Promise<RuntimeRunSnapshot>;
  cancel(session: string, run: string, owner: AgentHostOwner, credentials: AssistantCredentials): Promise<AgentHostCancelResponse>;
  artifact(session: string, artifact: string, owner: AgentHostOwner): Promise<RuntimeArtifact>;
  content(session: string, artifact: string, owner: AgentHostOwner): Promise<Buffer>;
  resolve(session: string, run: string, path: string, owner: AgentHostOwner): Promise<AgentHostArtifactResolution>;
}
