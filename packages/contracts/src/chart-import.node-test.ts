import assert from "node:assert/strict";
import test from "node:test";
import {chartImportRequestSchema,chartImportResponseSchema} from "./chart-import";
import {dashboardAddChartFileSchema} from "./dashboard-artifacts";
import {dashboardReplaceLayoutSchema,metricReferenceChartSchema} from "./dashboard";
const source={sessionId:"00000000-0000-4000-8000-000000000001",runId:"00000000-0000-4000-8000-000000000002",artifactId:"00000000-0000-4000-8000-000000000003"};
const content={dataset:[{id:"metric",dimensions:["name","value"],source:[]}],series:[{id:"main",type:"bar",datasetId:"metric",encode:{x:"name",y:"value"}}],ontomato:{}};
const file={name:"chart.chart.json",content};
test("chart import identity cannot override domain or owner and targets are exclusive",()=>{
  assert.equal(chartImportRequestSchema.safeParse(source).success,true);
  assert.equal(chartImportRequestSchema.safeParse({...source,ownerId:"other"}).success,false);
  assert.equal(dashboardAddChartFileSchema.safeParse({source,target:{name:"Board"}}).success,true);
  assert.equal(dashboardAddChartFileSchema.safeParse({source,target:{dashboardId:"board",groupId:"group"}}).success,true);
  assert.equal(dashboardAddChartFileSchema.safeParse({source,target:{name:"Board",dashboardId:"board",groupId:"group"}}).success,false);
});
test("stored cards and imported files reject snapshots or embedded references",()=>{
  const query={kind:"metric",metricId:"metric",parameters:{}};
  assert.equal(metricReferenceChartSchema.safeParse({id:"card",name:"Chart",query,chartFile:file}).success,true);
  assert.equal(chartImportResponseSchema.safeParse({file,query,source,metric:{name:"Metric",status:"PENDING_REVIEW",revision:"r"}}).success,true);
  for(const changed of [{...content,dataset:[{...content.dataset[0],source:[{name:"A",value:1}]}]},{...content,ontomato:{metric:{metricId:"metric",parameters:{}}}}]){
    assert.equal(metricReferenceChartSchema.safeParse({id:"card",name:"Chart",query,chartFile:{...file,content:changed}}).success,false);
  }
});
test("layout edits cannot replace a metric reference or reintroduce old drawing fields",()=>{
  const patch={id:"card",name:"New",chartFile:file};
  const input=(chart:unknown)=>({id:"board",groups:[{id:"group",title:"Group",charts:[chart],metrics:[]}]});
  assert.equal(dashboardReplaceLayoutSchema.safeParse(input(patch)).success,true);
  for(const extra of [{query:{kind:"metric",metricId:"other",parameters:{}}},{chartType:"line"},{fields:{xAxis:"name"}}])assert.equal(dashboardReplaceLayoutSchema.safeParse(input({...patch,...extra})).success,false);
});
