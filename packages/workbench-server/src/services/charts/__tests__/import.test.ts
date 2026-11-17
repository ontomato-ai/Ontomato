import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({artifact:vi.fn(),content:vi.fn(),resolve:vi.fn(),datasets:vi.fn(),describe:vi.fn(),settle:vi.fn()}));
vi.mock("../../assistant/service",()=>({assistantService:{artifact:mocks.artifact,content:mocks.content,resolve:mocks.resolve}}));
vi.mock("../../dashboard/create-from-analysis",()=>({resolveDashboardDatasets:mocks.datasets}));
vi.mock("../../dashboard/metric-client",()=>({DashboardMetricClient:class{describe=mocks.describe;settle=mocks.settle;}}));
import {prepareChartImport} from "../import";
import {HttpError} from "../../../utils/errors";
const owner={domainId:"domain",userId:"reader"};
const source={sessionId:"session",runId:"run",artifactId:"chart"};
function file(reference:Record<string,unknown>={metric:{metricId:"metric",parameters:{year:2026}}}){
  return {dataset:[{id:"metric",dimensions:["name","value"],source:[{name:"Archived",value:999}]}],series:[{id:"main",type:"bar",datasetId:"metric",encode:{x:"name",y:"value"}}],ontomato:reference};
}
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.artifact.mockResolvedValue({...source,id:"chart",path:"outputs/chart.chart.json"});
  mocks.content.mockResolvedValue(Buffer.from(JSON.stringify(file())));
  mocks.describe.mockResolvedValue({id:"metric",name:"Current metric",status:"PENDING_REVIEW",revision:"revision",outputColumns:[{key:"name"},{key:"value"}]});
});
it("imports an executable candidate using its drawing without checking old snapshot numbers",async()=>{
  const imported=await prepareChartImport(owner,{token:"caller"},source);
  expect(imported.query).toEqual({kind:"metric",metricId:"metric",parameters:{year:2026}});
  expect(imported.file.content.dataset[0].source).toEqual([]);
  expect(imported.file.content.ontomato).not.toHaveProperty("metric");
  expect(imported.metric.status).toBe("PENDING_REVIEW");
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.artifact).toHaveBeenCalledWith("session","chart",owner);
});
it("resolves a dataset within the chart's run and settles its accepted recipe with only required columns",async()=>{
  mocks.content.mockResolvedValue(Buffer.from(JSON.stringify(file({dataset:{path:"datasets/accepted.json"}}))));
  mocks.resolve.mockResolvedValue({artifact:{id:"accepted"}});
  const recipe={kind:"metric",metricId:"metric",revision:"old",parameters:{year:2026}};
  mocks.datasets.mockResolvedValue({datasets:[{subQuestion:"Accepted question",recipe}]});
  mocks.settle.mockResolvedValue({metricId:"metric",parameters:{year:2026}});
  const imported=await prepareChartImport(owner,{},source);
  expect(mocks.resolve).toHaveBeenCalledWith("session","run","datasets/accepted.json",owner);
  expect(mocks.datasets).toHaveBeenCalledWith("session",["accepted"],owner);
  expect(mocks.settle).toHaveBeenCalledWith({question:"Accepted question",recipe,outputShape:{cardKind:"chart",columns:["name","value"]}});
  expect(imported.file.content.series[0].type).toBe("bar");
  expect(imported.file.content.ontomato).not.toHaveProperty("dataset");
});
it("rejects absent source references before settlement or metric lookup",async()=>{
  mocks.content.mockResolvedValue(Buffer.from(JSON.stringify(file({}))));
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:422,code:"METRIC_REFERENCE_REQUIRED",details:{fields:["ontomato.metric","ontomato.dataset"]}});
  expect(mocks.describe).not.toHaveBeenCalled();expect(mocks.settle).not.toHaveBeenCalled();
});
it("retains missing columns and file paths in a mismatch",async()=>{
  mocks.describe.mockResolvedValue({name:"Metric",status:"PUBLISHED",revision:"r",outputColumns:[{key:"name"}]});
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:422,code:"CARD_OUTPUT_MISMATCH",details:{metricId:"metric",missingColumns:["value"],issues:[expect.objectContaining({path:["series",0,"encode","y"]})]}});
});
it("does not read an artifact from another run",async()=>{
  mocks.artifact.mockResolvedValue({runId:"another",path:"chart.chart.json"});
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:404});
  expect(mocks.content).not.toHaveBeenCalled();
});
it("propagates capability denial rather than returning an empty import",async()=>{
  mocks.describe.mockRejectedValue(new HttpError(403,"Denied","FORBIDDEN"));
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:403,code:"FORBIDDEN"});
});
it("stops when the workspace path has no accepted artifact",async()=>{
  mocks.content.mockResolvedValue(Buffer.from(JSON.stringify(file({dataset:{path:"missing.json"}}))));
  mocks.resolve.mockResolvedValue({artifact:null});
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:404});
  expect(mocks.settle).not.toHaveBeenCalled();
});
it("reports malformed JSON as a chart file boundary error",async()=>{
  mocks.content.mockResolvedValue(Buffer.from("{"));
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({status:422,code:"INVALID_CHART_FILE"});
});
it("does not settle an unaccepted dataset",async()=>{
  mocks.content.mockResolvedValue(Buffer.from(JSON.stringify(file({dataset:{path:"unaccepted.json"}}))));
  mocks.resolve.mockResolvedValue({artifact:{id:"unaccepted"}});
  mocks.datasets.mockRejectedValue(new HttpError(422,"Dataset was not accepted","DATASET_NOT_ACCEPTED"));
  await expect(prepareChartImport(owner,{},source)).rejects.toMatchObject({code:"DATASET_NOT_ACCEPTED"});
  expect(mocks.settle).not.toHaveBeenCalled();
});
