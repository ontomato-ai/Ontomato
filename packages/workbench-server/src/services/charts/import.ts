import { posix } from "node:path";
import { chartColumnReferences, splitChartFileForStorage, validateChartFile } from "@ontomato/contracts/chart-data";
import type { ChartImportRequest, ChartImportResponse } from "@ontomato/contracts/chart-import";
import type { DashboardMetricReference } from "@ontomato/contracts/dashboard";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { assistantService } from "../assistant/service";
import { resolveDashboardDatasets } from "../dashboard/create-from-analysis";
import { DashboardMetricClient } from "../dashboard/metric-client";
import { HttpError } from "../../utils/errors";

/** The artifact declares its source; the caller's metric permissions and output columns decide admission. */
export async function prepareChartImport(owner:AssistantOwner,credentials:AssistantCredentials,source:ChartImportRequest):Promise<ChartImportResponse>{
  const artifact=await assistantService.artifact(source.sessionId,source.artifactId,owner);
  if(artifact.runId!==source.runId)throw new HttpError(404,"Chart artifact not found","NOT_FOUND");
  const name=posix.basename(artifact.path);
  if(!name.endsWith(".chart.json"))throw new HttpError(422,"Choose a .chart.json artifact","INVALID_CHART_FILE");
  const bytes=await assistantService.content(source.sessionId,source.artifactId,owner);
  let content:unknown;
  try{content=JSON.parse(bytes.toString("utf8"));}
  catch(error){if(error instanceof SyntaxError)throw new HttpError(422,"Chart file is not valid JSON","INVALID_CHART_FILE",{issues:[{path:[],message:error.message}]});throw error;}
  const split=splitChartFileForStorage(content);
  if(!split.ok)throw new HttpError(422,"Invalid chart file",split.code,split);
  const client=new DashboardMetricClient(owner.domainId,credentials);
  let query:DashboardMetricReference;
  if(split.metric)query={kind:"metric",...split.metric};
  else if(split.dataset){
    const resolved=await assistantService.resolve(source.sessionId,source.runId,split.dataset.path,owner);
    if(!resolved.artifact)throw new HttpError(404,"Accepted dataset artifact not found","NOT_FOUND");
    const {datasets}=await resolveDashboardDatasets(source.sessionId,[resolved.artifact.id],owner);
    const dataset=datasets[0];
    const settled=await client.settle({question:dataset.subQuestion,recipe:dataset.recipe,outputShape:{cardKind:"chart",columns:[...new Set(chartColumnReferences(split.file).map(ref=>ref.column))]}});
    query={kind:"metric",metricId:settled.metricId,parameters:settled.parameters};
  }else throw new HttpError(422,"Chart requires ontomato.metric or ontomato.dataset","METRIC_REFERENCE_REQUIRED",{fields:["ontomato.metric","ontomato.dataset"]});
  const metric=await client.describe(query.metricId);
  const checked=validateChartFile(split.file,metric.outputColumns);
  if(!checked.ok)throw new HttpError(422,"Chart does not match MetricView output",checked.code,{metricId:query.metricId,...checked});
  return {file:{name,content:split.file},query,metric:{name:metric.name,status:metric.status,revision:metric.revision},source};
}
