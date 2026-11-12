/**
 * Workbench content supplied statically by the app: each edition's original values from before extraction, independent
 * of the UI locale and not derived from the Node message bundle. Three kinds: product literals that are the same fact as
 * in Node, historical matching rules (kept as-is, including known old inconsistencies), and standalone fixed UI text. Text that already has a t key still uses messages; error joining punctuation comes from errorPunctuation.
 */
export interface WorkbenchContent {
  /** Analysis agent MCP server name, the same value as Node product.analysisMcpServerName: identifies that server among published services on the MCP page (McpManager.vue). */
  analysisMcpServerName: string;
  /** Operations agent MCP server name, the same value as Node product.opsMcpServerName: identifies that server the same way (McpManager.vue). */
  opsMcpServerName: string;
  /**
   * Product protocol value of the observe page (/observe): the application log source in the live log sidebar, the same
   * value as Node product.logSource (LiveLogsPage.vue).
   */
  observe: {
    appLogSource: string;
  };
  text: WorkbenchFixedText;
  dashboard: DashboardVisuals;
}

/** UI text that was hard-coded in the original source (each edition's own sentences). */
export interface WorkbenchFixedText {
  /** Like/dislike rating labels of feedback records (FeedbackRecords.vue). */
  feedback: {
    like: string;
    dislike: string;
  };
  /**
   * Original sentences of the platform feedback records page (FeedbackRecords.vue): column titles, details, filter
   * placeholders, CSV headers and source cells, and messages. The same sentence shares one field across the page; the
   * like/dislike ratings use feedback.like/dislike above.
   */
  feedbackRecords: {
    sourceQa: string;
    sourceAnalysisTask: string;
    time: string;
    source: string;
    rating: string;
    user: string;
    input: string;
    output: string;
    feedback: string;
    relatedId: string;
    actions: string;
    details: string;
    detailTitle: string;
    searchPlaceholder: string;
    loadFailed: string;
    exportEmpty: string;
    exportSucceeded: string;
    exportFailed: string;
  };
  /** Original separator between error explanations and timeout text on the system and model configuration pages. */
  businessConfigSeparator: string;
  /** Dashboard creation failure (dashboard/api.ts). */
  createDashboardFailed: string;
  /** Display of an empty error message (query-view/utils/display-error.ts). */
  unknownError: string;
  /**
   * Sentences hard-coded in the observe page: the message the chat diagnosis entry sends automatically (ObserveLayout.vue),
   * the submitted values of welcome page quick questions (WelcomePage.vue; the display uses t keys), the "cancelled" label,
   * file load failure and large-file truncation notes of artifact details (ArtifactDetail.vue), and the test batch resume log (TestPage.vue).
   */
  observe: {
    autoTurnDiagnosisMessage: string;
    welcomePrompts: {
      analyzeSystem: string;
      troubleshootConfig: string;
      checkLLM: string;
      viewRecentErrors: string;
    };
    cancelled: string;
    fileLoadFailed: string;
    largeFilePreview: (loadedSize: string) => string;
    restoredTestBatch: (runId: string) => string;
  };
}

/**
 * Display details of dashboard charts (dashboard/components and utils). Chart colours are not content: they come from
 * the edition's brand source (features/dashboard/chart-palette.ts).
 */
export interface DashboardVisuals {
  /** Chart theme of the zoom dialog: either echarts' default theme or (open source) the platform's chart theme. */
  zoomChartTheme: "default" | "dashboard";
  /** Loading mask of charts and metric cards: the Element Plus default background or (open source) transparent. */
  loadingMask: "default" | "transparent";
  /** The generator's two original tooltip sentences: value with share, and the value/share line of tree maps. */
  chartTooltips: {
    valueWithPercent(value: string, percent: string): string;
    valueWithShare(key: string, value: string, percent: string): string;
  };
  /** Original reason sentences returned by the chart health check; chart is the chart type name at the start of the sentence and the numbers are the counts in it. */
  healthReasons: DashboardHealthReasons;
}

export interface DashboardHealthReasons {
  xAxisDataEmpty(chart: string): string;
  barSeriesMissing: string;
  lineSeriesMissing: string;
  barLineLengthMismatch: string;
  seriesDataEmpty(chart: string): string;
  areaLineAllZero: string;
  areaLineLengthMismatch(x: number, y: number): string;
  scatterIllegalPoints(n: number): string;
  radarIndicatorEmpty: string;
  radarValueEmpty: string;
  radarTooFewDimensions: string;
  radarLengthMismatch(indicators: number, values: number): string;
  radarIllegalMax: string;
  sankeyFieldsMissing: string;
  sankeyNodesEmpty: string;
  sankeyLinksEmpty: string;
  sankeyLinksOutsideNodes(n: number): string;
  sankeyAllZero: string;
  sankeyIllegalValues(n: number): string;
  sankeyDuplicateEdges(n: number): string;
  illegalValues(chart: string, n: number): string;
  boxplotIllegalItems(n: number): string;
  gaugeIllegalValue: string;
  liquidFillIllegalValues(n: number): string;
}

let content: WorkbenchContent | null = null;

export function installWorkbenchContent(next: WorkbenchContent): void {
  content = next;
}

/** Module-level code reads this at call time (not at module evaluation). */
export function workbenchContent(): WorkbenchContent {
  if (!content) throw new Error("Workbench content is not installed");
  return content;
}
