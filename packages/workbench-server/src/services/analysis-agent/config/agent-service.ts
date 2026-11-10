import type { AgentLineupEntry, AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import pg from "pg";
import { createLogger } from "../../../logging/logger";
import {
  DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
  DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
  isAnalysisAgentExecutionMode,
  isAnalysisReportSummaryPosition,
} from "./agent-types";
import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, qualifiedTable } from "../../../infrastructure/postgres";
import { renderPrompt } from "../../../core/prompts/loader";
import { SkillCategory, SkillType } from "../../../core/skills/constants";
import { skillRegistryManager } from "../../../core/skills/registry/manager";
import { t, tApp } from "../../../i18n";
import { DEFAULT_ANALYSIS_GRAPH_SCOPE, normalizeAnalysisGraphScope } from "./graph-scope";
import { placeQaAgent, resolveLineupSortOrders } from "./agent-lineup";

const logger = createLogger("analysis-agent-service");


const DEFAULT_AGENT_SORT_ORDER = 0;

function defaultAgentName() {
  return t("service.defaultAgentName");
}

function defaultAgentDescription() {
  return t("service.defaultAgentDescription");
}

function getDefaultAnalysisDimensionPrompt(): string {
  return renderPrompt("analysis-agent.shared.analysis-dimension.user");
}

function getDefaultSummarizerPrompt(): string {
  return renderPrompt("analysis-agent.shared.summarizer.user");
}

function getDefaultConclusionMakerPrompt(): string {
  return renderPrompt("analysis-agent.shared.conclusion-maker.user");
}

interface AnalysisAgentRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  execution_mode: string | null;
  loop_prompt: string | null;
  report_deliverable_enabled: boolean;
  hot_report_enabled: boolean;
  analysis_dimension_prompt: string | null;
  summarizer_prompt: string | null;
  conclusion_maker_prompt: string | null;
  summary_position?: string | null;
  enabled_skill_ids: string[] | null;
  enabled_visualization_skill_ids: string[] | null;
  enabled_mcp_service_names: string[] | null;
  enabled_action_ids: string[] | null;
  enabled_metric_view_ids: string[] | null;
  class_names: string[] | null;
  graph_scope: unknown;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class InvalidAgentSkillSelectionError extends Error {
  readonly code = "INVALID_AGENT_SKILL_SELECTION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentSkillSelectionError";
  }
}

export class AnalysisAgentService {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  async initialize(): Promise<void> {
    logger.info(tApp("analysis.config.agent-service.1"));
  }

  private async seedDefaultAgent(domainId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`seed-agent-${domainId}`]);
      const existing = await client.query(
        `SELECT id FROM ${qualifiedTable("analysis_agents")}
         WHERE domain_id = $1 LIMIT 1`,
        [domainId]
      );
      if ((existing.rowCount ?? 0) === 0) {
        const name = defaultAgentName();
        const description = defaultAgentDescription();
        const now = Date.now();
        await client.query(
          `INSERT INTO ${qualifiedTable("analysis_agents")}
           (id, name, description, analysis_dimension_prompt, summarizer_prompt,
            conclusion_maker_prompt, enabled_skill_ids, enabled_visualization_skill_ids,
             enabled_mcp_service_names, class_names, is_enabled, sort_order, domain_id,
             report_deliverable_enabled, graph_scope, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            uuidv4(),
            name,
            description,
            getDefaultAnalysisDimensionPrompt(),
            getDefaultSummarizerPrompt(),
            getDefaultConclusionMakerPrompt(),
            [],
            await this.getDefaultVisualizationSkillIds(domainId),
            [],
            [],
            true,
            DEFAULT_AGENT_SORT_ORDER,
            domainId,
            true,
            DEFAULT_ANALYSIS_GRAPH_SCOPE,
            now,
            now,
          ]
        );
        logger.info(tApp("analysis.config.agent-service.2"), { domainId });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAgents(domainId?: string): Promise<AnalysisAgent[]> {
    if (domainId) await this.seedDefaultAgent(domainId);
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")}
       WHERE domain_id = $1 ORDER BY sort_order ASC, created_at DESC`,
      [domainId || null]
    );
    return result.rows.map(mapAgentRow);
  }

  async getEnabledAgents(domainId?: string): Promise<AnalysisAgent[]> {
    if (domainId) await this.seedDefaultAgent(domainId);
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")}
       WHERE domain_id = $1 AND is_enabled = true
       ORDER BY sort_order ASC, created_at DESC`,
      [domainId || null]
    );
    return result.rows.map(mapAgentRow);
  }

  /** All agents of the domain, enabled or not, with the built-in Q&A agent placed among them. */
  async listAgentLineup(domainId: string): Promise<AgentLineupEntry[]> {
    const agents = await this.listAgents(domainId);
    const qa = await this.pool.query<{ sort_order: number }>(
      `SELECT sort_order FROM ${qualifiedTable("qa_agent_sort_orders")} WHERE domain_id = $1`,
      [domainId]
    );
    return placeQaAgent(agents, qa.rows[0]?.sort_order ?? null);
  }

  /** The only writer of agent order: one request saves the whole lineup, Q&A included. */
  async saveAgentLineup(domainId: string, order: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent-lineup-${domainId}`]);
      const current = await client.query<{ id: string }>(
        `SELECT id FROM ${qualifiedTable("analysis_agents")} WHERE domain_id = $1 FOR UPDATE`,
        [domainId]
      );
      const { qaSortOrder, agentSortOrders } = resolveLineupSortOrders(
        order,
        current.rows.map((row) => row.id)
      );
      await client.query(
        `UPDATE ${qualifiedTable("analysis_agents")} AS agent
         SET sort_order = lineup.sort_order
         FROM unnest($2::text[], $3::int[]) AS lineup(id, sort_order)
         WHERE agent.domain_id = $1 AND agent.id = lineup.id`,
        [
          domainId,
          agentSortOrders.map((entry) => entry.id),
          agentSortOrders.map((entry) => entry.sortOrder),
        ]
      );
      await client.query(
        `INSERT INTO ${qualifiedTable("qa_agent_sort_orders")} (domain_id, sort_order, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (domain_id) DO UPDATE
           SET sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at`,
        [domainId, qaSortOrder, Date.now()]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAgent(id: string, domainId?: string): Promise<AnalysisAgent | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("analysis_agents")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId || null]
    );
    return result.rows.length > 0 ? mapAgentRow(result.rows[0]) : null;
  }

  async createAgent(
    agent: Omit<
      AnalysisAgent,
      "id" | "createdAt" | "updatedAt" | "reportDeliverableEnabled" | "sortOrder"
    > & {
      reportDeliverableEnabled?: boolean;
    },
    domainId: string
  ): Promise<AnalysisAgent> {
    const enabledSkillIds = agent.enabledSkillIds === undefined ? [] : agent.enabledSkillIds;
    const enabledVisualizationSkillIds =
      agent.enabledVisualizationSkillIds === undefined
        ? await this.getDefaultVisualizationSkillIds(domainId)
        : agent.enabledVisualizationSkillIds;
    const enabledMcpServiceNames = normalizeStringList(agent.enabledMcpServiceNames);
    const enabledActionIds = normalizeStringList(agent.enabledActionIds);
    const enabledMetricViewIds = normalizeStringList(agent.enabledMetricViewIds);
    const classNames = normalizeStringList(agent.classNames);
    const graphScope = normalizeAnalysisGraphScope(agent.graphScope);
    await this.validateSkillSelections(enabledSkillIds, SkillCategory.ANALYSIS, domainId);
    await this.validateSkillSelections(
      enabledVisualizationSkillIds,
      SkillCategory.VISUALIZATION,
      domainId
    );

    const id = uuidv4();
    const now = Date.now();
    await this.pool.query(
       `INSERT INTO ${qualifiedTable("analysis_agents")}
       (id, name, description, icon, execution_mode, loop_prompt,
        analysis_dimension_prompt, summarizer_prompt,
        conclusion_maker_prompt, enabled_skill_ids, enabled_visualization_skill_ids,
        enabled_mcp_service_names, class_names, is_enabled, sort_order, domain_id,
         report_deliverable_enabled, hot_report_enabled, summary_position, graph_scope, created_at, updated_at,
         enabled_action_ids, enabled_metric_view_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [
        id,
        agent.name,
        agent.description || null,
        agent.icon || null,
        isAnalysisAgentExecutionMode(agent.executionMode)
          ? agent.executionMode
          : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
        agent.loopPrompt || null,
        agent.analysisDimensionPrompt || null,
        agent.summarizerPrompt || null,
        agent.conclusionMakerPrompt || null,
        enabledSkillIds,
        enabledVisualizationSkillIds,
        enabledMcpServiceNames,
        classNames,
        agent.isEnabled !== false ? true : false,
        DEFAULT_AGENT_SORT_ORDER,
        domainId,
        agent.reportDeliverableEnabled ?? true,
        agent.hotReportEnabled ?? true,
        isAnalysisReportSummaryPosition(agent.summaryPosition)
          ? agent.summaryPosition
          : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
        graphScope,
        now,
        now,
        enabledActionIds,
        enabledMetricViewIds,
      ]
    );
    logger.info(tApp("analysis.config.agent-service.3", { id: id, name: agent.name }));
    return (await this.getAgent(id, domainId))!;
  }

  async updateAgent(
    id: string,
    updates: Partial<AnalysisAgent>,
    domainId?: string
  ): Promise<AnalysisAgent | null> {
    if (updates.enabledSkillIds !== undefined) {
      const existing = await this.getAgent(id, domainId);
      await this.validateSkillSelections(updates.enabledSkillIds, SkillCategory.ANALYSIS, domainId, existing?.enabledSkillIds);
    }
    if (updates.enabledVisualizationSkillIds !== undefined) {
      await this.validateSkillSelections(
        updates.enabledVisualizationSkillIds,
        SkillCategory.VISUALIZATION,
        domainId
      );
    }
    if (updates.enabledMcpServiceNames !== undefined) {
      updates.enabledMcpServiceNames = normalizeStringList(updates.enabledMcpServiceNames);
    }
    if (updates.enabledActionIds !== undefined) {
      updates.enabledActionIds = normalizeStringList(updates.enabledActionIds);
    }
    if (updates.enabledMetricViewIds !== undefined) {
      updates.enabledMetricViewIds = normalizeStringList(updates.enabledMetricViewIds);
    }
    if (updates.classNames !== undefined) {
      updates.classNames = normalizeStringList(updates.classNames);
    }
    if (updates.graphScope !== undefined) {
      updates.graphScope = normalizeAnalysisGraphScope(updates.graphScope);
    }

    const now = Date.now();
    const sets: string[] = ["updated_at = $1"];
    const vals: any[] = [now];
    let idx = 2;

    if (updates.name !== undefined) {
      vals.push(updates.name);
      sets.push(`name = $${idx++}`);
    }
    if (updates.description !== undefined) {
      vals.push(updates.description);
      sets.push(`description = $${idx++}`);
    }
    if (updates.icon !== undefined) {
      vals.push(updates.icon);
      sets.push(`icon = $${idx++}`);
    }
    if (updates.executionMode !== undefined) {
      vals.push(
        isAnalysisAgentExecutionMode(updates.executionMode)
          ? updates.executionMode
          : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE
      );
      sets.push(`execution_mode = $${idx++}`);
    }
    if (updates.reportDeliverableEnabled !== undefined) {
      vals.push(updates.reportDeliverableEnabled);
      sets.push(`report_deliverable_enabled = $${idx++}`);
    }
    if (updates.hotReportEnabled !== undefined) {
      vals.push(updates.hotReportEnabled);
      sets.push(`hot_report_enabled = $${idx++}`);
    }
    if (updates.enabledMcpServiceNames !== undefined) {
      vals.push(updates.enabledMcpServiceNames);
      sets.push(`enabled_mcp_service_names = $${idx++}`);
    }
    if (updates.enabledActionIds !== undefined) {
      vals.push(updates.enabledActionIds);
      sets.push(`enabled_action_ids = $${idx++}`);
    }
    if (updates.enabledMetricViewIds !== undefined) {
      vals.push(updates.enabledMetricViewIds);
      sets.push(`enabled_metric_view_ids = $${idx++}`);
    }
    if (updates.loopPrompt !== undefined) {
      vals.push(updates.loopPrompt);
      sets.push(`loop_prompt = $${idx++}`);
    }
    if (updates.analysisDimensionPrompt !== undefined) {
      vals.push(updates.analysisDimensionPrompt);
      sets.push(`analysis_dimension_prompt = $${idx++}`);
    }
    if (updates.summarizerPrompt !== undefined) {
      vals.push(updates.summarizerPrompt);
      sets.push(`summarizer_prompt = $${idx++}`);
    }
    if (updates.conclusionMakerPrompt !== undefined) {
      vals.push(updates.conclusionMakerPrompt);
      sets.push(`conclusion_maker_prompt = $${idx++}`);
    }
    if (updates.summaryPosition !== undefined) {
      vals.push(
        isAnalysisReportSummaryPosition(updates.summaryPosition)
          ? updates.summaryPosition
          : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION
      );
      sets.push(`summary_position = $${idx++}`);
    }
    if (updates.enabledSkillIds !== undefined) {
      vals.push(updates.enabledSkillIds);
      sets.push(`enabled_skill_ids = $${idx++}`);
    }
    if (updates.enabledVisualizationSkillIds !== undefined) {
      vals.push(updates.enabledVisualizationSkillIds);
      sets.push(`enabled_visualization_skill_ids = $${idx++}`);
    }
    if (updates.classNames !== undefined) {
      vals.push(updates.classNames);
      sets.push(`class_names = $${idx++}`);
    }
    if (updates.graphScope !== undefined) {
      vals.push(updates.graphScope);
      sets.push(`graph_scope = $${idx++}`);
    }
    if (updates.isEnabled !== undefined) {
      vals.push(updates.isEnabled);
      sets.push(`is_enabled = $${idx++}`);
    }

    if (sets.length === 1) return this.getAgent(id, domainId);

    vals.push(id, domainId || null);
    const result = await this.pool.query(
      `UPDATE ${qualifiedTable("analysis_agents")} SET ${sets.join(", ")}
       WHERE id = $${idx} AND domain_id = $${idx + 1}
       RETURNING *`,
      vals
    );

    if ((result.rowCount ?? 0) === 0) {
      logger.warn(tApp("analysis.config.agent-service.4", { id: id }));
      return null;
    }
    logger.info(tApp("analysis.config.agent-service.5", { id: id }));
    return mapAgentRow(result.rows[0]);
  }

  async deleteAgent(id: string, domainId?: string): Promise<boolean> {
    await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_dimensions")}
       WHERE agent_id = $1 AND EXISTS (
         SELECT 1 FROM ${qualifiedTable("analysis_agents")}
         WHERE id = $1 AND domain_id = $2
       )`,
      [id, domainId || null]
    );
    const result = await this.pool.query(
      `DELETE FROM ${qualifiedTable("analysis_agents")} WHERE id = $1 AND domain_id = $2`,
      [id, domainId || null]
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info(tApp("analysis.config.agent-service.6", { id: id }));
      return true;
    }
    logger.warn(tApp("analysis.config.agent-service.7", { id: id }));
    return false;
  }

  private async getDefaultVisualizationSkillIds(domainId: string): Promise<string[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    return registry
      .getSkills({
        category: SkillCategory.VISUALIZATION,
        type: SkillType.EXECUTABLE,
      })
      .map((skill) => skill.id);
  }

  private async validateSkillSelections(
    skillIds: string[],
    category: (typeof SkillCategory)[keyof typeof SkillCategory],
    domainId?: string,
    previousSkillIds: readonly string[] = []
  ): Promise<void> {
    if (!Array.isArray(skillIds) || skillIds.some((skillId) => typeof skillId !== "string")) {
      throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.8"));
    }

    if (!domainId) {
      throw new InvalidAgentSkillSelectionError("domainId is required");
    }
    const registry = await skillRegistryManager.forDomain(domainId);
    const catalog = new Map(
      registry.getSkills({ includeDisabled: true }).map((skill) => [skill.id, skill])
    );

    for (const skillId of new Set(skillIds)) {
      const skill = catalog.get(skillId);
      if (!skill) {
        throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.9", { skillId: skillId }));
      }
      if (skillId === "generate-ppt" && !registry.isSkillEnabled(skillId) && !previousSkillIds.includes(skillId)) {
        throw new InvalidAgentSkillSelectionError(tApp("skills.resolve.disabled", {id: skillId}));
      }
      if (skill.manifest.category !== category) {
        throw new InvalidAgentSkillSelectionError(
          tApp("analysis.config.agent-service.10", { skillId: skillId, category: skill.manifest.category, category2: category })
        );
      }
      if (
        category === SkillCategory.VISUALIZATION &&
        skill.manifest.type !== SkillType.EXECUTABLE
      ) {
        throw new InvalidAgentSkillSelectionError(tApp("analysis.config.agent-service.11", { skillId: skillId }));
      }
    }
  }
}

let analysisAgentService: AnalysisAgentService | null = null;

/** The single accessor for AnalysisAgentService: instantiated and initialized once per process. */
export async function getAnalysisAgentService(): Promise<AnalysisAgentService> {
  if (!analysisAgentService) {
    analysisAgentService = new AnalysisAgentService();
    await analysisAgentService.initialize();
  }
  return analysisAgentService;
}

function mapAgentRow(row: AnalysisAgentRow): AnalysisAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    icon: row.icon || undefined,
    executionMode: isAnalysisAgentExecutionMode(row.execution_mode)
      ? row.execution_mode
      : DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
    loopPrompt: row.loop_prompt || undefined,
    reportDeliverableEnabled: row.report_deliverable_enabled !== false,
    hotReportEnabled: row.hot_report_enabled !== false,
    analysisDimensionPrompt: row.analysis_dimension_prompt || getDefaultAnalysisDimensionPrompt(),
    summarizerPrompt: row.summarizer_prompt || getDefaultSummarizerPrompt(),
    conclusionMakerPrompt: row.conclusion_maker_prompt || getDefaultConclusionMakerPrompt(),
    summaryPosition: isAnalysisReportSummaryPosition(row.summary_position)
      ? row.summary_position
      : DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION,
    enabledSkillIds: row.enabled_skill_ids || [],
    enabledVisualizationSkillIds: row.enabled_visualization_skill_ids || [],
    enabledMcpServiceNames: row.enabled_mcp_service_names || [],
    enabledActionIds: row.enabled_action_ids || [],
    enabledMetricViewIds: row.enabled_metric_view_ids || [],
    classNames: row.class_names || [],
    graphScope: normalizeAnalysisGraphScope(row.graph_scope),
    isEnabled: row.is_enabled,
    sortOrder: row.sort_order ?? 0,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}
