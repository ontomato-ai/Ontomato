import type { WorkbenchContent } from "@ontomato/workbench-ui";
import { ossProduct } from "../../src/product";

/**
 * Static workbench content for this edition (original values). The MCP server names and observe protocol values come
 * directly from this edition's Node product; the rest are the original matching rules and sentences from the web source
 * before extraction, independent of the UI locale. Colours are not here: they come from the brand source.
 */
export const workbenchContent: WorkbenchContent = {
  analysisMcpServerName: ossProduct.analysisMcpServerName,
  opsMcpServerName: ossProduct.opsMcpServerName,
  observe: {
    appLogSource: ossProduct.logSource,
  },
  text: {
    createDashboardFailed: "Failed to create dashboard",
    unknownError: "Unknown error",
    feedback: {
      like: "Like",
      dislike: "Dislike",
    },
    businessConfigSeparator: ": ",
    feedbackRecords: {
      sourceQa: "Query",
      sourceAnalysisTask: "Analysis Task",
      time: "Time",
      source: "Source",
      rating: "Rating",
      user: "User",
      input: "Input",
      output: "Output",
      feedback: "Feedback",
      relatedId: "Related ID",
      actions: "Actions",
      details: "Details",
      detailTitle: "Feedback Details",
      searchPlaceholder: "Search user, input, output, or feedback",
      loadFailed: "Failed to load feedback records",
      exportEmpty: "No feedback records to export",
      exportSucceeded: "Feedback records exported successfully",
      exportFailed: "Failed to export feedback records",
    },
    observe: {
      autoTurnDiagnosisMessage: "Diagnose this Turn's problem.",
      welcomePrompts: {
        analyzeSystem: "Analyze system status",
        troubleshootConfig: "Troubleshoot configuration issues",
        checkLLM: "Check LLM connectivity",
        viewRecentErrors: "View recent errors",
      },
      cancelled: "Cancelled",
      fileLoadFailed: "Failed to load file content",
      largeFilePreview: (loadedSize) =>
        `File is large, only the beginning ${loadedSize} was loaded; search only covers the current preview. The full content can be viewed by downloading the artifact.`,
      restoredTestBatch: (runId) => `Restored test batch ${runId}`,
    },
  },
  dashboard: {
    loadingMask: "transparent",
  },
};
