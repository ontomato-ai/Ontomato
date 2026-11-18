import { isDeepStrictEqual } from "node:util";
import { validateStoredChartFile } from "@ontomato/contracts/chart-data";
import type { MetricReferenceChartEntry, DashboardAuthoringForm } from "@ontomato/contracts/dashboard";
import { prepareChartImport } from "../charts/import";
import { validatePersonalDashboardMetrics } from "../product-assets/validation";
import { randomUUID } from "node:crypto";

import type { DashboardAddChartFile, DashboardAddArtifact } from "@ontomato/contracts/dashboard-artifacts";
import { HttpError } from "../../utils/errors";
import {
  ensureDashboard,
  parseDashboardInput,
  findGroup,
  requireDashboardId,
  requireGroupId,
} from "./access";
import { resolveDashboardDatasets } from "./create-from-analysis";
import { planReferenceDashboard } from "./reference-planning";
import { DashboardMetricClient } from "./metric-client";
import { dashboardReplaceLayoutSchema } from "@ontomato/contracts/dashboard";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  saveDashboard,
} from "./store";
export async function createEmptyDashboard(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  const detail = await createDashboard({ ownerId, domainId, name, groups: [] });
  return { id: detail.id, name: detail.name };
}
export async function createDashboardDimension(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const id = requireDashboardId(body?.id);
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, id),
  );
  const groupTitle = String(body?.dimensionName || "").trim();
  if (!groupTitle) throw new HttpError(400, "dimensionName is required");
  detail.groups.push({
    id: randomUUID(),
    title: groupTitle,
    charts: [],
    metrics: [],
  });
  await saveDashboard(ownerId, domainId, detail);
}
export async function addDashboardChart(
  ownerId: string, domainId: string, body: DashboardAddArtifact, credentials: AssistantCredentials,
) {
  const { dashboardId, groupId, sessionId, datasetArtifactId } = body;
  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, dashboardId));
  const group = findGroup(detail, groupId);
  const { datasets } = await resolveDashboardDatasets(sessionId, [datasetArtifactId], { userId: ownerId, domainId });
  const planned = await planReferenceDashboard(datasets, new DashboardMetricClient(domainId, credentials));
  const charts = planned.groups.flatMap(item => item.charts);
  const metrics = planned.groups.flatMap(item => item.metrics);
  group.charts.push(...charts);
  group.metrics.push(...metrics);
  await saveDashboard(ownerId, domainId, detail);
  return { cardIds: [...charts, ...metrics].map(card => card.id) };
}

export async function renameDashboard(
  ownerId: string,
  domainId: string,
  body: DashboardAuthoringForm<"dashboard.rename">,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  detail.name = name;
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardById(
  ownerId: string,
  domainId: string,
  body: any,
) {
  await deleteDashboard(ownerId, domainId, requireDashboardId(body?.id));
}
export async function renameDashboardDimension(
  ownerId: string,
  domainId: string,
  body: DashboardAuthoringForm<"dashboard.group.rename">,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const group = findGroup(detail, requireGroupId(body?.groupId));
  group.title = String(body?.dimensionName || "").trim();
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardDimension(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const groupId = requireGroupId(body?.groupId);
  detail.groups = detail.groups.filter((group) => group.id !== groupId);
  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboardChart(
  ownerId: string,
  domainId: string,
  body: DashboardAuthoringForm<"dashboard.chart.rename">,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const chartId = String(body?.chartId || "").trim();
  const name = String(body?.resultSetName || "").trim();
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) chart.name = name;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardChart(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const chartId = String(body?.chartId || "").trim();
  for (const group of detail.groups) {
    group.charts = group.charts.filter((item) => item.id !== chartId);
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function replaceDashboardLayout(ownerId: string, domainId: string, input: unknown, credentials: AssistantCredentials) {
  const body=parseDashboardInput(dashboardReplaceLayoutSchema,input);
  const detail=ensureDashboard(ownerId,await getDashboard(ownerId,domainId,body.id));
  const charts=new Map(detail.groups.flatMap(group=>group.charts).map(card=>[card.id,card]));
  const metrics=new Map(detail.groups.flatMap(group=>group.metrics).map(card=>[card.id,card]));
  const client=new DashboardMetricClient(domainId,credentials);
  detail.groups=await Promise.all(body.groups.map(async group=>({
    id:group.id,title:group.title,
    charts:await Promise.all(group.charts.map(async patch=>{
      const card=charts.get(patch.id);
      if(!card)throw new HttpError(400,"Layout can only contain saved cards","INVALID_REQUEST");
      if(patch.chartFile&&!isDeepStrictEqual(patch.chartFile,card.chartFile)){
        const metric=await client.describe(card.query.metricId);
        const checked=validateStoredChartFile(patch.chartFile.content,metric.outputColumns);
        if(!checked.ok)throw new HttpError(422,"Chart file does not match MetricView output","CARD_OUTPUT_MISMATCH",{cardId:card.id,metricId:card.query.metricId,missingColumns:checked.missingColumns,issues:checked.issues});
      }
      return {...card,...patch};
    })),
    metrics:group.metrics.map(patch=>{
      const card=metrics.get(patch.id);
      if(!card)throw new HttpError(400,"Layout can only contain saved cards","INVALID_REQUEST");
      return {...card,...patch};
    }),
  })));
  await saveDashboard(ownerId,domainId,detail);
}
export async function renameDashboardMetric(
  ownerId: string,
  domainId: string,
  body: DashboardAuthoringForm<"dashboard.metric.rename">,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const metricId = String(body?.metricId || "").trim();
  const metricName = String(body?.metricName || "").trim();
  for (const group of detail.groups) {
    const metric = group.metrics.find((item) => item.id === metricId);
    if (metric) metric.name = metricName;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardMetric(
  ownerId: string,
  domainId: string,
  body: any,
) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id)),
  );
  const metricId = String(body?.metricId || "").trim();
  for (const group of detail.groups) {
    group.metrics = group.metrics.filter((item) => item.id !== metricId);
  }
  await saveDashboard(ownerId, domainId, detail);
}

/** A file import keeps its drawing and stores only the target card's metric reference. */
export async function addDashboardChartFile(ownerId:string,domainId:string,body:DashboardAddChartFile,credentials:AssistantCredentials){
  let detail, group;
  if("dashboardId" in body.target){
    detail=await getDashboard(ownerId,domainId,body.target.dashboardId);
    detail=ensureDashboard(ownerId,detail);
    group=findGroup(detail,body.target.groupId);
  }
  const prepared=await prepareChartImport({userId:ownerId,domainId},credentials,body.source);
  const name=body.title??prepared.file.name.replace(/\.chart\.json$/,"");
  const card:MetricReferenceChartEntry={id:randomUUID(),name,query:prepared.query,chartFile:prepared.file,layout:{colSpan:12,rowSpan:1},source:prepared.source};
  if(!detail){
    group={id:randomUUID(),title:prepared.metric.name,charts:[card],metrics:[]};
    await validatePersonalDashboardMetrics([group],new DashboardMetricClient(domainId,credentials));
    detail=await createDashboard({ownerId,domainId,name:(body.target as {name:string}).name,groups:[group]});
  }else{
    group!.charts.push(card);
    await saveDashboard(ownerId,domainId,detail);
  }
  return {id:detail.id,name:detail.name,groupId:group!.id,cardIds:[card.id]};
}
