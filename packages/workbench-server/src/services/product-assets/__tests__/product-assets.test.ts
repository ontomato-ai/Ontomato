import { describe,expect,it } from "vitest";
import { productAssetInputSchema,productReferences } from "@ontomato/contracts/product-assets";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import {productDependencies} from '@ontomato/contracts/product-dependencies';
const widget={id:"w",kind:"metric",title:"Count",span:4,valueField:"count",resourceId:"published-metric",parameters:{}};
describe("product asset admission",()=>{
  it('separates display groups from panels that offer business actions',()=>{
    expect(productAssetInputSchema.safeParse({name:'Invalid panel',document:{kind:'operation-panel',widgets:[widget]}}).success).toBe(false);
    expect(productAssetInputSchema.safeParse({name:'Figures',document:{kind:'widget-group',widgets:[widget]}}).success).toBe(true);
    const action={...widget,id:'action',kind:'action',resourceId:'published-action'};
    expect(productAssetInputSchema.safeParse({name:'Panel',document:{kind:'operation-panel',widgets:[widget,action]}}).success).toBe(true);
    expect(productAssetInputSchema.safeParse({name:'Invalid group',document:{kind:'widget-group',widgets:[action]}}).success).toBe(false);
  });
  it('rejects result paths and data overrides that the row-array runtime cannot honor',()=>{
    for(const value of [{...widget,resultPath:'rows'},{...widget,binding:{source:'variable',path:'inventedRows'}},{...widget,targetClass:'Employee'}]){
      expect(productAssetInputSchema.safeParse({name:'Invalid',document:{kind:'widget',widget:value}}).success).toBe(false);
    }
  });
  it('finds transitive application usage without exposing parents outside the visible snapshot',()=>{
    const base={ownerId:'alice',revision:1,createdAt:'now',updatedAt:'now',editable:true,visibility:'private' as const,description:''};
    const leaf={...base,...productAssetInputSchema.parse({name:'Metric',document:{kind:'widget',widget}}),id:'leaf'};
    const page={...base,...productAssetInputSchema.parse({name:'Page',document:{kind:'page',workspace:defaultPersonalWorkspace(),children:[{assetId:'leaf',column:'main'}]}}),id:'page'};
    const app={...base,...productAssetInputSchema.parse({name:'App',document:{kind:'application',applicationId:'app',children:[{assetId:'page',column:'main'}]}}),id:'application'};
    expect(productDependencies(app,[leaf,page,app]).references).toContainEqual({kind:'metric',id:'published-metric'});
    expect(productDependencies(leaf,[leaf,page,app]).usedBy.map(asset=>asset.id)).toEqual(['page','application']);
    expect(productDependencies(leaf,[leaf]).usedBy).toEqual([]);
  });
  it.each([
    {...widget,sql:"select count(*) from employees"},
    {...widget,dsl:{select:"count"}},
    {...widget,kind:"properties",fields:["salary"]},
    {...widget,visibleWhen:{binding:{source:"object",path:"amount"},operator:"eq",value:"5000"}},
    {...widget,parameters:{department:{source:"object",path:"department"}}},
  ])("rejects embedded business logic and direct object access",invalid=>{
    expect(productAssetInputSchema.safeParse({name:"Invalid",document:{kind:"widget",widget:invalid}}).success).toBe(false);
  });
  it("derives references from the executable configuration and rejects an independent dependency list",()=>{
    const input=productAssetInputSchema.parse({name:"Page",document:{kind:"page",workspace:{...defaultPersonalWorkspace(),dashboardIds:["board"],applicationIds:["app"]},children:[{assetId:"widget",column:"main"}]}});
    expect(productReferences(input.document)).toEqual(expect.arrayContaining([{kind:"asset",id:"widget"},{kind:"dashboard",id:"board"},{kind:"application",id:"app"}]));
    expect(productAssetInputSchema.safeParse({...input,references:[{kind:"metric",id:"invented"}]}).success).toBe(false);
  });
  it("retains capability IDs and typed literal parameters across save/read parsing",()=>{
    const input=productAssetInputSchema.parse({name:"Metric",document:{kind:"widget",widget:{...widget,parameters:{limit:{source:"literal",value:0},optional:{source:"literal",value:null}}}}});
    expect(productReferences(input.document)).toEqual([{kind:"metric",id:"published-metric"}]);
    expect(productAssetInputSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
  it("keeps an object selection independent from its class view and preserves metric identity across chart styles",()=>{
    const document=productAssetInputSchema.parse({name:'Object view',document:{kind:'object-view',className:'Employee',form:'full'}}).document;
    expect(productReferences(document)).toEqual([{kind:'object-view',id:'Employee'}]);
    expect(productReferences({...document,primaryKey:'alice'} as typeof document)).toEqual(productReferences(document));
    const chart=productAssetInputSchema.parse({name:'Chart',document:{kind:'widget',widget:{...widget,kind:'chart',labelField:'department',chartType:'bar'}}});
    if(chart.document.kind!=='widget')throw new Error('Expected widget');
    const donut={...chart.document,widget:{...chart.document.widget,chartType:'donut' as const}};
    expect(productReferences(donut)).toEqual(productReferences(chart.document));
  });
});
