export function getAnalysisAgentMcpUrlOverride(): string {
  return String(process.env.ANALYSIS_AGENT_MCP_URL || "").trim();
}
