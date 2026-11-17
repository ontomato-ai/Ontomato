import {beforeEach,expect,it,vi} from "vitest";
vi.mock("../../../i18n",()=>({t:(key:string)=>key,tApp:(key:string)=>key}));
const mocks=vi.hoisted(()=>({owned:vi.fn(),get:vi.fn(),save:vi.fn(),create:vi.fn(),prepare:vi.fn(),plan:vi.fn()}));
vi.mock("../store",()=>({getDashboard:mocks.get,saveDashboard:mocks.save,createDashboard:mocks.create,deleteDashboard:vi.fn()}));
vi.mock("../access",async()=>({...await vi.importActual<typeof import("../access")>("../access"),getOwnedDashboard:mocks.owned}));
vi.mock("../../charts/import",()=>({prepareChartImport:mocks.prepare}));
vi.mock("../reference-planning",()=>({planReferenceDashboard:mocks.plan}));
vi.mock("../create-from-analysis",()=>({resolveDashboardDatasets:vi.fn()}));
import {queryMetricCard} from "../metric-data";
import {addDashboardChartFile,replaceDashboardLayout} from "../mutations";
import {HttpError} from "../../../utils/errors";
import type {DashboardMetricClient} from "../metric-client";
const owner={domainId:"domain",userId:"reader"};
const query={kind:"metric" as const,metricId:"metric",parameters:{year:2026}};
const file={name:"chart.chart.json",content:{dataset:[{id:"metric" as const,dimensions:["name","value"],source:[]}],series:[{id:"main",type:"bar",datasetId:"metric" as const,encode:{x:"name",y:"value"}}],ontomato:{}}};
const source={sessionId:"s",runId:"r",artifactId:"a"};
function board(){return {id:"board",ownerId:"reader",name:"Board",groups:[{id:"group",title:"Group",charts:[{id:"card",name:"Chart",query,chartFile:file}],metrics:[]}]};}
beforeEach(()=>{
  vi.resetAllMocks();mocks.get.mockResolvedValue(board());mocks.owned.mockResolvedValue(board());
  mocks.prepare.mockResolvedValue({file,query,metric:{name:"Metric",status:"PENDING_REVIEW",revision:"revision"},source});
});
it("returns one file beside current rows and passes truncation through",async()=>{
  const truncation={truncated:true as const,rowLimit:1,truncationHint:"Partial"};
  const api={describe:vi.fn().mockResolvedValue({id:"metric",name:"Metric",status:"PENDING_REVIEW",revision:"r"}),execute:vi.fn().mockResolvedValue({columns:[{key:"name"},{key:"value"}],rows:[{name:"Current",value:0}],truncation})};
  const result=await queryMetricCard(owner,{dashboardId:"board",cardId:"card"},api as unknown as DashboardMetricClient);
  expect(result).toMatchObject({file,rows:[{name:"Current",value:0}],truncation});
  expect(result.card).not.toHaveProperty("chartFile");
  expect(api.execute).toHaveBeenCalledWith(query,"r");
});
it("rejects a numeric card whose metric becomes multi-row",async()=>{
  mocks.owned.mockResolvedValue({groups:[{charts:[],metrics:[{id:"number",name:"Number",query,valueField:"value"}]}]});
  const api={describe:vi.fn().mockResolvedValue({revision:"r"}),execute:vi.fn().mockResolvedValue({columns:[{key:"value"}],rows:[{value:1},{value:2}],truncation:null})};
  await expect(queryMetricCard(owner,{dashboardId:"board",cardId:"number"},api as unknown as DashboardMetricClient)).rejects.toMatchObject({code:"CARD_OUTPUT_MISMATCH"});
});
it("checks the target before importing and appends only the prepared drawing",async()=>{
  mocks.get.mockResolvedValueOnce(null);
  await expect(addDashboardChartFile("reader","domain",{source,target:{dashboardId:"missing",groupId:"group"}},{})).rejects.toMatchObject({status:404});
  expect(mocks.prepare).not.toHaveBeenCalled();
  await addDashboardChartFile("reader","domain",{source,target:{dashboardId:"board",groupId:"group"}},{});
  expect(mocks.save.mock.calls[0][2].groups[0].charts[1]).toMatchObject({chartFile:file,query,source});
  expect(mocks.plan).not.toHaveBeenCalled();
});
it("does not create a dashboard when file preparation is rejected",async()=>{
  mocks.prepare.mockRejectedValue(new HttpError(422,"Missing source","METRIC_REFERENCE_REQUIRED"));
  await expect(addDashboardChartFile("reader","domain",{source,target:{name:"New"}},{})).rejects.toMatchObject({code:"METRIC_REFERENCE_REQUIRED"});
  expect(mocks.create).not.toHaveBeenCalled();
});
it("keeps the saved query when layout edits replace only the drawing",async()=>{
  await replaceDashboardLayout("reader","domain",{id:"board",groups:[{id:"group",title:"Group",charts:[{id:"card",name:"Renamed",chartFile:file}],metrics:[]}]});
  expect(mocks.save.mock.calls[0][2].groups[0].charts[0]).toMatchObject({name:"Renamed",query,chartFile:file});
  await expect(replaceDashboardLayout("reader","domain",{id:"board",groups:[{id:"group",title:"Group",charts:[{id:"card",query:{...query,metricId:"other"}}],metrics:[]}]})).rejects.toMatchObject({code:"INVALID_REQUEST"});
});
