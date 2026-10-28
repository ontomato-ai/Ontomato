import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { AnalysisReportHotCardSummary } from "@ontomato/contracts/analysis-report";
import { nodeApiBlobPost, nodeApiDelete, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";

export const analysisAgentApi = {
  async listAgents(): Promise<AnalysisAgent[]> {
    const res = await nodeApiGet("/analysis-agents");
    // Handle two response formats: { success: true, data: [...] } or directly return [...]
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    if (Array.isArray(res)) {
      return res;
    }
    return [];
  },
  async getEnabledAgents(): Promise<AnalysisAgent[]> {
    const res = await nodeApiGet("/analysis-agents/enabled");
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    if (res.data && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    if (Array.isArray(res)) {
      return res;
    }
    return [];
  },
  async getAgent(id: string): Promise<AnalysisAgent> {
    const res = await nodeApiGet(`/analysis-agents/${id}`);
    return res.data?.data || res.data;
  },
  async listHotReports(id: string): Promise<AnalysisReportHotCardSummary[]> {
    const res = await nodeApiGet(`/analysis-agents/${id}/hot-reports`);
    const data = res.data ?? res;
    return Array.isArray(data) ? data : [];
  },
  async createAgent(
    agent: Omit<AnalysisAgent, "id" | "createdAt" | "updatedAt">
  ): Promise<AnalysisAgent> {
    const res = await nodeApiPost("/analysis-agents", agent);
    return res.data;
  },
  async updateAgent(id: string, updates: Partial<AnalysisAgent>): Promise<AnalysisAgent> {
    const res = await nodeApiPut(`/analysis-agents/${id}`, updates);
    return res.data;
  },
  async deleteAgent(id: string): Promise<void> {
    await nodeApiDelete(`/analysis-agents/${id}`);
  },
};


export const analysisReportApi = {
  exportPdf: (body: unknown) => nodeApiBlobPost("/reports/export-pdf", body),
  listCards: (queryString: string) => nodeApiGet(`/analysis-reports/cards${queryString}`),
  getCard: (id: string) => nodeApiGet(`/analysis-reports/cards/${id}`),
  deleteCard: (id: string) => nodeApiDelete(`/analysis-reports/cards/${id}`),
  updateCardStatus: (id: string, status: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/status`, { status }),
  updateCardBusinessDescription: (id: string, businessDescription: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/business-description`, { businessDescription }),
  summarizePpt: (body: unknown) => nodeApiPost("/ppt/summarize", body),
  pptDefaults: () => nodeApiGet("/ppt/defaults"),
};
