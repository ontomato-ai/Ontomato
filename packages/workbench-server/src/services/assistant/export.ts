import { type AssistantOwner } from "./store";
import { assistantService } from "./service";
import { renderChartHtmlToDataUrl } from "../analysis-agent/delivery/chart-renderer";
import { HttpError } from "../../utils/errors";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { exportChartTheme } from "../chart-theme";
/** Resolve file references from the owning run before passing content to existing export renderers. */
export async function exportMarkdown(
  sessionId: string,
  runId: string,
  markdown: string,
  owner: AssistantOwner,
  signal?: AbortSignal,
  ancestors: ReadonlySet<string> = new Set(),
) {
  const references = [
    ...markdown.matchAll(/(!?)\[([^\]]*)\]\((outputs\/[^\s)]+)\)/g),
  ];
  for (const match of references) {
    signal?.throwIfAborted();
    if (ancestors.has(match[3]))
      throw new HttpError(400, `Circular artifact reference: ${match[3]}`);
    const a = (
      await assistantService.resolve(sessionId, runId, match[3], owner)
    ).artifact;
    if (!a) throw new HttpError(404, `Artifact unavailable: ${match[3]}`);
    const bytes = await assistantService.content(sessionId, a.id, owner);
    let rendered: string;
    if (a.path.endsWith(".chart.json")) {
      const option = JSON.stringify(chartBrandColors(JSON.parse(bytes.toString()), exportChartTheme())).replaceAll(
        "<",
        "\\u003c",
      );
      const html = `<div id="chart" style="width:1000px;height:500px"></div><script>echarts.init(document.getElementById('chart')).setOption(${option});</script>`;
      rendered = `![${match[2]}](${await renderChartHtmlToDataUrl(html, 30000, { offline: true, signal })})`;
    } else if (a.path.endsWith(".png"))
      rendered = `![${match[2]}](data:image/png;base64,${bytes.toString("base64")})`;
    else if (a.path.endsWith(".dataset.json")) {
      const { payload } = await assistantService.dataset(
        sessionId,
        a.id,
        owner,
      );
      rendered = `${payload.title}\n\n${payload.truncation?.truncationHint ?? ""}\n\n${JSON.stringify({ columns: payload.columns, rows: payload.rows })}`;
    } else if (a.path.endsWith(".md"))
      rendered = await exportMarkdown(
        sessionId,
        runId,
        bytes.toString(),
        owner,
        signal,
        new Set([...ancestors, match[3]]),
      );
    else rendered = `${match[2]} (${a.path})`;
    markdown = markdown.replace(match[0], rendered);
  }
  return markdown;
}
