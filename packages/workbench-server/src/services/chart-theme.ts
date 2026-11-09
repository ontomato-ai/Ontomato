let installed: Record<string, unknown> = {};
export function installChartTheme(theme: Record<string, unknown>) { installed = theme; }
export function exportChartTheme() { return installed; }
