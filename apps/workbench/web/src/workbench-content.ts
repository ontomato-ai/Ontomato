import type { WorkbenchContent } from "@ontomato/workbench-ui";
import { ossProduct } from "../../src/product";
import { ossWorkspaceArtifactText } from "../../src/workspace-artifact-text";

/**
 * Static workbench content for this edition (original values). The MCP server names and observe protocol values come
 * directly from this edition's Node product; the rest are the original matching rules and sentences from the web source
 * before extraction, independent of the UI locale. Colours are not here: they come from the brand source.
 */
export const workbenchContent: WorkbenchContent = {
  analysisMcpServerName: ossProduct.analysisMcpServerName,
  opsMcpServerName: ossProduct.opsMcpServerName,
  skillDebugEchartsInput: JSON.stringify(
    {
      data: [
        { category: "Electronics", sales: 15000 },
        { category: "Clothing", sales: 12000 },
        { category: "Food", sales: 8000 },
        { category: "Home", sales: 6000 },
      ],
      chartType: "bar",
      xField: "category",
      yField: "sales",
      title: "Sales comparison by category",
    },
    null,
    2
  ),
  observe: {
    appLogSource: ossProduct.logSource,
    promptTranscript: ossWorkspaceArtifactText,
    promptDirectoryName: ossProduct.diagnosisWorkspaceNames.prompts,
  },
  text: {
    createDashboardFailed: "Failed to create dashboard",
    skillsListInvalid: "Invalid skills list response format: missing skills array",
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
    zoomChartTheme: "dashboard",
    loadingMask: "transparent",
    chartTooltips: {
      valueWithPercent: (value, percent) => `${value} (${percent}%)`,
      valueWithShare: (key, value, percent) => `${key}: ${value}<br/>Share: ${percent}%`,
    },
    healthReasons: {
      xAxisDataEmpty: (chart) => `${chart}: xAxis.data is empty`,
      barSeriesMissing: "bar-line: missing bar series",
      lineSeriesMissing: "bar-line: missing line series",
      barLineLengthMismatch: "bar-line: series.data length does not match xAxis.data",
      seriesDataEmpty: (chart) => `${chart}: series[0].data is empty`,
      areaLineAllZero: "area-line: series[0].data is all zeros (ECharts often renders it blank",
      areaLineLengthMismatch: (x, y) => `area-line: xAxis.data(${x}) length does not match series.data(${y})`,
      scatterIllegalPoints: (n) => `scatter: data has ${n} illegal point(s) (may contain NaN/undefined/empty x)`,
      radarIndicatorEmpty: "radar: radar.indicator is empty",
      radarValueEmpty: "radar: series[0].data[0].value is empty",
      radarTooFewDimensions: "radar: too few dimensions (≤2), the radar chart can hardly present a meaningful comparison",
      radarLengthMismatch: (indicators, values) => `radar: indicator(${indicators}) length does not match value(${values})`,
      radarIllegalMax: "radar: indicator.max has an illegal value (<=0 / non-numeric)",
      sankeyFieldsMissing: "sankey: fields missing source/target/value",
      sankeyNodesEmpty: "sankey: nodes(data) is empty",
      sankeyLinksEmpty: "sankey: links is empty",
      sankeyLinksOutsideNodes: (n) => `sankey: ${n} link(s) have source/target not in nodes`,
      sankeyAllZero: "sankey: all links.value are <= 0 (ECharts often renders it blank); consider using counts / frequencies or showing a table instead",
      sankeyIllegalValues: (n) => `sankey: ${n} link(s) have illegal value (NaN/Infinity/undefined)`,
      sankeyDuplicateEdges: (n) => `sankey: ${n} duplicate source->target edge(s) exist (consider merging/summing)`,
      illegalValues: (chart, n) => `${chart}: ${n} value(s) in data are illegal`,
      boxplotIllegalItems: (n) => `boxplot: ${n} item(s) are not a valid 5-array or contain illegal numeric values`,
      gaugeIllegalValue: "gauge: data[0].value is illegal (NaN/Infinity/undefined)",
      liquidFillIllegalValues: (n) => `liquid-fill: ${n} illegal numeric value(s) in data`,
    },
  },
};
