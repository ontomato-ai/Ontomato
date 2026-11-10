export type AnalysisAgentExecutionMode = "dimension" | "loop";

/** Display position of the comprehensive summary in the report. Historical agents default to the end of the report. */
export type AnalysisReportSummaryPosition = "top" | "bottom";

export type AnalysisGraphScope =
  | { mode: "panorama" }
  | { mode: "subgraph"; rootClassNames: string[]; maxDepth: number };

export interface AnalysisAgent {
  /** Business ID (UUID) */
  id: string;
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Icon (optional) */
  icon?: string;
  /** Execution form marker; agents without one use dimension orchestration */
  executionMode: AnalysisAgentExecutionMode;
  /** Loop-form prompt: role positioning, analysis method, and report structure requirements; only effective in loop form */
  loopPrompt?: string;
  /** Whether a report deliverable is attached; when off, the loop delivers via the final reply and trajectory */
  reportDeliverableEnabled: boolean;
  /** Whether hot report matching is on; when off, the analysis pipeline skips hot report reuse and always re-analyzes with the current configuration */
  hotReportEnabled?: boolean;
  /** Analysis dimension prompt (used to split dimensions into sub-questions) */
  analysisDimensionPrompt?: string;
  /** Dimension report generation prompt */
  summarizerPrompt: string;
  /** Multi-dimension summary prompt */
  conclusionMakerPrompt: string;
  /** Display position of the comprehensive summary in the report; unconfigured historical agents render at the end */
  summaryPosition?: AnalysisReportSummaryPosition;
  /** Enabled analysis skill ID list */
  enabledSkillIds?: string[];
  /** Enabled analysis visualization skill ID list */
  enabledVisualizationSkillIds?: string[];
  /** Snapshot of external MCP service names explicitly authorized to the loop supervisor */
  enabledMcpServiceNames?: string[];
  /** Published ontology Action IDs a regular-session agent may execute after the user confirms in the conversation */
  enabledActionIds?: string[];
  /** Published read-only metric view IDs the agent's loop may execute, such as a knowledge search over a vector attribute */
  enabledMetricViewIds?: string[];
  /** Associated object class names, limiting dimension splitting and query scope */
  classNames?: string[];
  /** Initial ontology exploration scope. Panorama is the backward-compatible default. */
  graphScope: AnalysisGraphScope;
  /** Whether enabled */
  isEnabled: boolean;
  /** Sort order (smaller values first); written only through the agent lineup */
  sortOrder?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Update timestamp */
  updatedAt: number;
}

/**
 * Lineup ID of the built-in Q&A agent. It is not an analysis agent and has no agent record:
 * it takes part in the lineup order but cannot be edited, disabled or deleted.
 */
export const QA_AGENT_LINEUP_ID = "__qa__";

/**
 * One entry of a domain's agent lineup (`GET /analysis-agents/lineup`), already in display
 * order. The server owns the order; the agent manager and the workbench rail render it as given.
 */
export type AgentLineupEntry = { kind: "qa" } | { kind: "agent"; agent: AnalysisAgent };

/**
 * Body of `PUT /analysis-agents/lineup`: every agent ID of the domain plus
 * `QA_AGENT_LINEUP_ID`, each exactly once, in the new display order.
 */
export interface SaveAgentLineupRequest {
  order: string[];
}

export type DimensionType = "categorical" | "temporal" | "numeric";

export type DimensionValueSource = "static" | "dataset_field";

export interface AnalysisDimension {
  id: string;
  agentId: string;
  name: string;
  dimensionType: DimensionType;
  values?: string[];
  valueSource: DimensionValueSource;
  datasetField?: string;
  subQuestionTemplate: string;
  order?: number;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}
