import express from "express";
import {createServer} from "node:http";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rename:vi.fn(),chart:vi.fn(),metric:vi.fn(),group:vi.fn(),layout:vi.fn(),parameters:vi.fn(),agentConfirm:vi.fn()}));
vi.mock("../../../services/dashboard/mutations",()=>({renameDashboard:mocks.rename,renameDashboardChart:mocks.chart,renameDashboardMetric:mocks.metric,renameDashboardDimension:mocks.group,replaceDashboardLayout:mocks.layout,addDashboardChart:vi.fn(),addDashboardChartFile:vi.fn(),createDashboardDimension:vi.fn(),createEmptyDashboard:vi.fn(),deleteDashboardById:vi.fn(),deleteDashboardChart:vi.fn(),deleteDashboardDimension:vi.fn(),deleteDashboardMetric:vi.fn()}));
vi.mock("../../../services/dashboard/store",()=>({getDashboard:vi.fn(),listDashboards:vi.fn()}));
vi.mock("../../../services/dashboard/create-from-analysis",()=>({createDashboardFromAnalysis:vi.fn()}));
vi.mock("../../../services/dashboard/metric-client",()=>({DashboardMetricClient:class{}}));
vi.mock("../../../services/dashboard/metric-data",()=>({queryMetricCard:vi.fn(),metricCardParameterForm:vi.fn(),saveMetricCardParameters:mocks.parameters}));
vi.mock("../../../services/dashboard/agent-confirm",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("../../../services/dashboard/agent-confirm")>();
  return {...actual,prepareDashboardAgentConfirm:mocks.agentConfirm};
});
vi.mock("../../../services/product-assets/register-dashboard",()=>({registerDashboardProduct:vi.fn()}));
vi.mock("../../../identity/installed",()=>({workbenchIdentity:()=>({requireDomainId:(identity:{domainId:string})=>identity.domainId})}));
import router from "../dashboards";
let server:ReturnType<typeof createServer>,base:string;
beforeEach(async()=>{
  vi.clearAllMocks();const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{userId:"reader",domainId:"domain",token:"caller"});next();});app.use("/api/dashboards",router);
  server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/dashboards`;
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
function post(path:string,body:unknown){return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
it("uses the shared rename body at the HTTP boundary before the writer",async()=>{
  const bad=await post("/modify",{id:"board",name:12});expect(bad.status).toBe(400);
  expect(await bad.json()).toMatchObject({code:"INVALID_REQUEST",details:{issues:[expect.objectContaining({path:["name"]})]}});expect(mocks.rename).not.toHaveBeenCalled();
  const good=await post("/modify",{id:"board",name:" New name "});expect(good.status).toBe(200);
  expect(mocks.rename).toHaveBeenCalledWith("reader","domain",{id:"board",name:"New name"});
});
it("keeps the original card, metric, group and parameter save endpoints",async()=>{
  const chart={id:"board",chartId:"card",resultSetName:"Chart"};expect((await post("/modifyResultSetName",chart)).status).toBe(200);expect(mocks.chart).toHaveBeenCalledWith("reader","domain",chart);
  const metric={id:"board",metricId:"number",metricName:"Number"};expect((await post("/modifyMetricName",metric)).status).toBe(200);expect(mocks.metric).toHaveBeenCalledWith("reader","domain",metric);
  const group={id:"board",groupId:"group",dimensionName:"Group"};expect((await post("/modifyDimensionName",group)).status).toBe(200);expect(mocks.group).toHaveBeenCalledWith("reader","domain",group);
  const parameters={dashboardId:"board",cardId:"card",revision:"r",values:{year:"2026"}};expect((await post("/save-card-parameters",parameters)).status).toBe(200);expect(mocks.parameters).toHaveBeenCalledWith({userId:"reader",domainId:"domain"},parameters,expect.anything());
});
it("validates and forwards agent-confirm requests at the HTTP boundary",async()=>{
  const bad=await post("/agent-confirm",{dashboardId:"board",operation:"invalid"});expect(bad.status).toBe(400);
  expect(mocks.agentConfirm).not.toHaveBeenCalled();
  mocks.agentConfirm.mockResolvedValue({intentId:"intent-1",autoMode:false,questionId:"q-1",label:"Save dashboard changes"});
  const payload={dashboardId:"board",operation:"board.save",targetLabel:"Sales",impactSummary:"Dashboard name",agentRun:{sessionId:"s1",runId:"r1",toolCallId:"tc1"}};
  const good=await post("/agent-confirm",payload);expect(good.status).toBe(200);
  expect(await good.json()).toEqual({success:true,data:{intentId:"intent-1",autoMode:false,questionId:"q-1",label:"Save dashboard changes"}});
  expect(mocks.agentConfirm).toHaveBeenCalledWith({userId:"reader",domainId:"domain"},expect.objectContaining({token:"caller"}),payload,undefined);
});
it("retires the independent analysis endpoint",async()=>{expect((await post("/ai/analyze",{})).status).toBe(404);});
