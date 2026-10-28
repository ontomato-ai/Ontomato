import { nodeApiDelete, nodeApiGet, nodeApiPut } from "../../utils/api";

export const analysisReportApi = {
  listCards: (queryString: string) => nodeApiGet(`/analysis-reports/cards${queryString}`),
  getCard: (id: string) => nodeApiGet(`/analysis-reports/cards/${id}`),
  deleteCard: (id: string) => nodeApiDelete(`/analysis-reports/cards/${id}`),
  updateCardStatus: (id: string, status: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/status`, { status }),
  updateCardBusinessDescription: (id: string, businessDescription: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/business-description`, { businessDescription }),
};
