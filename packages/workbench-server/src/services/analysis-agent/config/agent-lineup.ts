import {
  QA_AGENT_LINEUP_ID,
  type AgentLineupEntry,
  type AnalysisAgent,
} from "@ontomato/contracts/analysis-agent";

/**
 * The single ordering rule of a domain's agent lineup. `agents` arrive in the agent list order
 * (`sort_order ASC, created_at DESC`); the Q&A agent shares that sort space and goes before the
 * first agent whose sort order is not smaller than its own. A domain that has never saved a
 * lineup has no Q&A sort order and shows Q&A first.
 */
export function placeQaAgent(
  agents: readonly AnalysisAgent[],
  qaSortOrder: number | null
): AgentLineupEntry[] {
  const entries: AgentLineupEntry[] = agents.map((agent) => ({ kind: "agent", agent }));
  const index =
    qaSortOrder === null ? 0 : agents.findIndex((agent) => (agent.sortOrder ?? 0) >= qaSortOrder);
  entries.splice(index === -1 ? entries.length : index, 0, { kind: "qa" });
  return entries;
}

export class AgentLineupMismatchError extends Error {
  readonly code = "AGENT_LINEUP_MISMATCH";

  constructor() {
    super(
      `Agent lineup must list every agent of the domain and ${QA_AGENT_LINEUP_ID} exactly once`
    );
    this.name = "AgentLineupMismatchError";
  }
}

/**
 * Turns a requested lineup into sort orders. The request must be a permutation of the domain's
 * current agent IDs plus the Q&A entry, so a stale page cannot drop or invent entries.
 */
export function resolveLineupSortOrders(
  order: readonly string[],
  agentIds: readonly string[]
): { qaSortOrder: number; agentSortOrders: { id: string; sortOrder: number }[] } {
  const expected = new Set([...agentIds, QA_AGENT_LINEUP_ID]);
  if (
    order.length !== expected.size ||
    new Set(order).size !== order.length ||
    order.some((id) => !expected.has(id))
  ) {
    throw new AgentLineupMismatchError();
  }
  return {
    qaSortOrder: order.indexOf(QA_AGENT_LINEUP_ID),
    agentSortOrders: order.flatMap((id, sortOrder) =>
      id === QA_AGENT_LINEUP_ID ? [] : [{ id, sortOrder }]
    ),
  };
}
