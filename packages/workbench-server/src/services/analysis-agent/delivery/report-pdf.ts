import { exportMarkdownPdf } from "./pdf-export";
/** `<task name>_YYYY-MM-DDTHH-mm-ss.pdf`, with the timestamp taken from server local time. */
function analysisReportPdfFileName(taskName: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${taskName}_${stamp}.pdf`;
}

export async function exportAnalysisReportPdf(
  source: { title: string; markdown: string },
  now: Date,
) {
  const bytes = await exportMarkdownPdf({
    title: source.title,
    markdown: source.markdown,
    renderInlineCharts: true,
  });
  return { bytes, fileName: analysisReportPdfFileName(source.title, now) };
}
