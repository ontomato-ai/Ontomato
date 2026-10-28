import type {
  RuntimeRun,
  RuntimeRunSnapshot,
} from "./agent-runtime";
import type { RuntimeArtifact } from "./agent-runtime-artifacts";
import type {
  RuntimeCursor,
  RuntimeStreamFrame,
} from "./agent-runtime-events";

/**
 * A feature entry in the shell navigation. `page` entries render host content in the main area,
 * `action` entries let the host react in place (for example a dialog), `link` entries navigate
 * away; `unavailable` entries are visible placeholders without an action.
 */
export interface ShellFeatureDeclaration {
  id: string;
  label: string;
  /** Icon name from the shared lucide set, resolved by the shell. */
  icon: string;
  availability: "page" | "action" | "link" | "unavailable";
  href?: string;
  /** Short hint shown next to an unavailable entry. */
  hint?: string;
}

/** A workbench is a code declaration, not a page-builder schema. Agents come from the host. */
export interface ShellWorkbenchDeclaration {
  id: string;
  label: string;
  /** Workbenches in another application are links; local ones switch in place. */
  href?: string;
  features: ShellFeatureDeclaration[];
}

/** Agent definition as the shell displays it; disabled agents keep their history selectable. */
export interface ShellAgent {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/** PI run state only; the shell never derives a completed/failed/needs-input outcome. */
export type ShellRunState = Pick<RuntimeRun, "id" | "status" | "stopReason" | "errorMessage">;

/** Host session index entry. */
export interface ShellSession {
  id: string;
  agentId: string;
  /** The first user message, verbatim; empty until the first run is accepted. */
  title: string;
  createdAt: string;
  updatedAt: string;
  latestRun: Pick<ShellRunState, "id" | "status" | "stopReason"> | null;
}

export interface ShellSessionPage {
  sessions: ShellSession[];
  nextCursor: string | null;
}

/** The runtime run snapshot fields the shell reads; host snapshots may carry more. */
export type ShellRunSnapshot = Pick<
  RuntimeRunSnapshot,
  "cursor" | "messages" | "pendingMessages" | "toolExecutions" | "artifacts"
> & { run: ShellRunState };

export interface ShellSessionSnapshot {
  session: ShellSession;
  /** Settled history ordered by messageSeq, including the latest run's settled messages. */
  messages: RuntimeRunSnapshot["messages"];
  latestRun: ShellRunSnapshot | null;
}

export interface ShellSendInput {
  agentId: string;
  /** Null starts a new session; the host creates it before admitting the run. */
  sessionId: string | null;
  text: string;
}

export interface ShellSendResult {
  /** The session created for this message; null when the message continued an existing one. */
  createdSession: ShellSession | null;
  snapshot: ShellRunSnapshot;
}

export interface ShellArtifactQuery {
  sessionId: string;
  runId: string;
  /** Workspace-relative outputs/ path exactly as referenced in Markdown. */
  path: string;
}

export interface ShellFeedbackTarget {
  sessionId: string;
  runId: string;
  messageId: string;
}

export interface ShellFeedbackValue {
  rating: "like" | "dislike";
  /** Required for dislike. */
  reason: string;
}

export interface ShellFeedbackPort {
  read(target: ShellFeedbackTarget): Promise<ShellFeedbackValue | null>;
  submit(target: ShellFeedbackTarget, value: ShellFeedbackValue): Promise<ShellFeedbackValue>;
  remove(target: ShellFeedbackTarget): Promise<void>;
}

/** Called once per stream; the host decides transport. */
export interface ShellStreamHandlers {
  frame(frame: RuntimeStreamFrame): void;
  /** Transport ended without a terminal run state; the shell re-reads the snapshot. */
  error(error: unknown): void;
}

/**
 * Everything the shell needs from its host. Messages, events and artifacts keep the runtime's PI
 * shapes; the host authorizes, indexes sessions and proxies reads.
 */
export interface AgentShellPort {
  listAgents(): Promise<ShellAgent[]>;
  listSessions(agentId: string, cursor: string | null): Promise<ShellSessionPage>;
  readSession(sessionId: string): Promise<ShellSessionSnapshot>;
  deleteSession(sessionId: string): Promise<void>;
  /** Creates the session when needed, admits the run and returns its first snapshot. */
  send(input: ShellSendInput): Promise<ShellSendResult>;
  readRun(sessionId: string, runId: string): Promise<ShellRunSnapshot>;
  subscribe(
    sessionId: string,
    runId: string,
    after: Pick<RuntimeCursor, "seq" | "streamId">,
    handlers: ShellStreamHandlers,
  ): () => void;
  cancel(sessionId: string, runId: string): Promise<void>;
  /** The run's version of a path: at its end once stopped, the current one while running. */
  resolveArtifact(query: ShellArtifactQuery): Promise<RuntimeArtifact | null>;
  /** Bytes through the authenticated host proxy; renderers never see storage paths. */
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
  feedback?: ShellFeedbackPort;
}
