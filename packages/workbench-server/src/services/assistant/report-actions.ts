import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { parseProductMarkdown, type ImageNode, type LinkNode } from "@ontomato/markdown";
import type { DashboardGroup } from "@ontomato/contracts/dashboard";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { nodesOfType } from "../analysis-agent/delivery/markdown-nodes";
import { exportMarkdownPdf } from "../analysis-agent/delivery/pdf-export";
import { prepareChartImport } from "../charts/import";
import { resolveDashboardDatasets } from "../dashboard/create-from-analysis";
import { DashboardMetricClient } from "../dashboard/metric-client";
import { planReferenceDashboard } from "../dashboard/reference-planning";
import { createDashboard } from "../dashboard/store";
import { validatePersonalDashboardMetrics } from "../dashboard/validation";
import { exportMarkdown } from "./export";
import { exportAssistantReportChartTheme } from "../chart-theme";
import { assistantService } from "./service";
import type { AssistantOwner } from "./store";

async function readReport(sessionId: string, artifactId: string, owner: AssistantOwner) {
  const artifact = await assistantService.artifact(sessionId, artifactId, owner);
  if (!artifact.path.startsWith("outputs/") || !/\.md$/i.test(artifact.path))
    throw new HttpError(404, "Report not found");
  const markdown = (await assistantService.content(sessionId, artifactId, owner)).toString("utf8");
  if (!markdown.trim()) throw new HttpError(422, "The report is empty", "EMPTY_REPORT");
  return { artifact, markdown, title: posix.basename(artifact.path).replace(/\.md$/i, "") };
}

export async function downloadAssistantReport(sessionId: string, artifactId: string, owner: AssistantOwner, locale?: string) {
  const report = await readReport(sessionId, artifactId, owner);
  const markdown = await exportMarkdown(sessionId, report.artifact.runId, report.markdown, owner, undefined, undefined, locale, exportAssistantReportChartTheme());
  const bytes = await exportMarkdownPdf({ title: report.title, markdown, locale, offline: true, renderInlineCharts: true });
  return { bytes, fileName: `${report.title}.pdf` };
}

export async function createDashboardFromReport(
  sessionId: string,
  artifactId: string,
  name: string,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
) {
  const { artifact, markdown } = await readReport(sessionId, artifactId, owner);
  const nodes = parseProductMarkdown(markdown);
  const paths = new Set([
    ...nodesOfType<LinkNode>(nodes, "link").map(node => node.href),
    ...nodesOfType<ImageNode>(nodes, "image").map(node => node.src),
  ].map(path => {
    if (path.startsWith("outputs/")) return posix.normalize(path);
    if (path.startsWith("./") || path.startsWith("../")) return posix.join(posix.dirname(artifact.path), path);
    return "";
  }).filter(path => /^outputs\/.*\.(?:chart|dataset)\.json$/.test(path)));
  if (!paths.size) throw new HttpError(422, "The report does not reference charts or datasets", "REPORT_NO_DASHBOARD_SOURCES");

  const groups: DashboardGroup[] = [];
  const datasetIds: string[] = [];
  for (const path of paths) {
    const { artifact: source } = await assistantService.resolve(sessionId, artifact.runId, path, owner);
    if (!source) throw new HttpError(404, `Report source unavailable: ${path}`);
    if (source.path.endsWith(".dataset.json")) {
      datasetIds.push(source.id);
      continue;
    }
    const chart = await prepareChartImport(owner, credentials, {
      sessionId, runId: source.runId, artifactId: source.id,
    });
    groups.push({
      id: randomUUID(),
      title: chart.metric.name,
      metrics: [],
      charts: [{
        id: randomUUID(),
        name: chart.file.name.replace(/\.chart\.json$/, ""),
        query: chart.query,
        chartFile: chart.file,
        layout: { colSpan: 12, rowSpan: 1 },
        source: chart.source,
      }],
    });
  }
  const client = new DashboardMetricClient(owner.domainId, credentials);
  if (datasetIds.length) {
    const { datasets } = await resolveDashboardDatasets(sessionId, datasetIds, owner);
    groups.push(...(await planReferenceDashboard(datasets, client)).groups);
  }
  await validatePersonalDashboardMetrics(groups, client);
  const board = await createDashboard({ ownerId: owner.userId, domainId: owner.domainId, source: { sessionId }, name, groups });
  return { id: board.id, name: board.name };
}
