let installed: Record<string, unknown> = {};
let assistantReportTheme: Record<string, unknown> | undefined;
export function installChartTheme(theme: Record<string, unknown>) { installed = theme; }
export function exportChartTheme() { return installed; }
/** A product may brand assistant-report charts without changing charts elsewhere in the workbench. */
export function installAssistantReportChartTheme(theme?: Record<string, unknown>) { assistantReportTheme = theme; }
export function exportAssistantReportChartTheme() { return assistantReportTheme ?? installed; }
