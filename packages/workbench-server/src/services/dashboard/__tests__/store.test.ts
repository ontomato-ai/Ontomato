import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../i18n",()=>({t:(key:string)=>key,tApp:(key:string)=>key}));
import {getDashboard} from "../store";
const card={id:"card",name:"Chart",query:{kind:"metric",metricId:"metric",parameters:{}},chartFile:{name:"chart.chart.json",content:{dataset:[{id:"metric",dimensions:["name","value"],source:[]}],series:[{id:"main",type:"bar",datasetId:"metric",encode:{x:"name",y:"value"}}],ontomato:{}}}};
function row(charts:unknown[]){return {id:"board",owner_id:"reader",name:"Board",created_at:"1",updated_at:"2",groups:[{id:"group",title:"Group",charts,metrics:[]}]};}
beforeEach(()=>{vi.resetAllMocks();});
it("reads new groups without writing normalized cards back",async()=>{
  mocks.query.mockResolvedValue({rows:[row([card])]});
  const read=await getDashboard("reader","domain","board");
  expect(read?.groups[0].charts[0]).toEqual(card);
  expect(mocks.query.mock.calls.every(([sql])=>sql.trimStart().startsWith("SELECT"))).toBe(true);
});
it("reports the precise saved-card path instead of patching or filtering legacy data",async()=>{
  mocks.query.mockResolvedValue({rows:[row([{id:"old",name:"Old",chartType:"bar",fields:{}}])]});
  await expect(getDashboard("reader","domain","board")).rejects.toMatchObject({code:"INVALID_CARD_DATA",details:{issues:expect.arrayContaining([expect.objectContaining({path:["groups",0,"charts",0,"chartFile"]})])}});
  expect(mocks.query.mock.calls.every(([sql])=>sql.trimStart().startsWith("SELECT"))).toBe(true);
});
