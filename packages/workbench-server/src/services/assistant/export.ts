import type { PptSourceSection } from "@ontomato/contracts/ppt";
import { assistantStore, type AssistantOwner } from "./store";
import { assistantService } from "./service";
import { readAssistantHistory } from "./evidence";
import { renderChartHtmlToDataUrl } from "../analysis-agent/delivery/chart-renderer";
import { generatePpt } from "../analysis-agent/delivery/ppt-generator";
import { HttpError } from "../../utils/errors";
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
      const option = JSON.stringify(JSON.parse(bytes.toString())).replaceAll(
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
export async function exportConversationPpt(
  sessionId: string,
  owner: AssistantOwner,
  signal?: AbortSignal,
) {
  const session = await assistantStore.session(sessionId, owner),
    history = await readAssistantHistory(sessionId, owner),
    sections: PptSourceSection[] = [];
  for (const turn of history.turns) {
    sections.push({
      id: turn.turnId,
      heading: turn.question,
      content: await exportMarkdown(
        sessionId,
        turn.turnId,
        turn.answer,
        owner,
        signal,
      ),
    });
    for (const q of turn.queries)
      for (const d of q.datasetsPayload ?? []) {
        const columns = [
          ...new Set(
            (d.rows as Record<string, unknown>[]).flatMap((r) =>
              Object.keys(r),
            ),
          ),
        ];
        sections.push({
          id: d.id,
          heading: d.title,
          content: d.truncationHint ?? "",
          tables: [
            {
              columns,
              rows: d.rows.map((r: Record<string, unknown>) =>
                columns.map((c) => r[c]),
              ),
            },
          ],
          ...(d.truncated
            ? {
                truncated: d.truncated,
                rowLimit: d.rowLimit,
                truncationHint: d.truncationHint,
              }
            : {}),
        });
      }
  }
  if (!sections.length) throw new HttpError(400, "Conversation is empty");
  return generatePpt(session.title, sections, {}, signal);
}
