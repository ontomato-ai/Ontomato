import { runtimeDefaults } from "../runtime/defaults";
export function getSystemMcpUrl(): string {
  const configured = String(process.env.MCP_SERVER_URL || "").trim();
  return (configured ? configured : runtimeDefaults().systemMcpUrlFallback).replace(/\/$/, "");
}
export function getAnalysisAgentMcpUrlOverride(): string {
  return String(process.env.ANALYSIS_AGENT_MCP_URL || "").trim();
}
