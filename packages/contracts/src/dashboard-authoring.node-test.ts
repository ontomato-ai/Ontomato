import assert from "node:assert/strict";
import test from "node:test";
import {dashboardAuthoring,dashboardOperationSchema} from "./dashboard";
const forms={
  "dashboard.layout":{id:"board",groups:[{id:"group",title:"Group",charts:[],metrics:[]}]},
  "dashboard.rename":{id:"board",name:"Renamed"},
  "dashboard.chart.rename":{id:"board",chartId:"chart",resultSetName:"Chart"},
  "dashboard.metric.rename":{id:"board",metricId:"number",metricName:"Number"},
  "dashboard.group.rename":{id:"board",groupId:"group",dimensionName:"Group"},
  "dashboard.card.parameters":{dashboardId:"board",cardId:"card",revision:"revision",values:{year:"2026"}},
};
test("each dashboard operation validates its own original save body",()=>{
  for(const [name,form] of Object.entries(forms)){
    const operation=dashboardOperationSchema.parse(name);
    assert.equal(dashboardAuthoring[operation].schema.safeParse(form).success,true);
    assert.equal(dashboardAuthoring[operation].schema.safeParse({...form,query:{metricId:"other"}}).success,false);
  }
  assert.equal(dashboardAuthoring["dashboard.rename"].schema.safeParse({id:"board",name:"   "}).success,false);
  assert.equal(dashboardAuthoring["dashboard.card.parameters"].schema.safeParse({...forms["dashboard.card.parameters"],values:{year:2026}}).success,false);
});
