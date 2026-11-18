import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {ElButton,ElFormItem,ElInput,ElInputNumber,ElOption,ElSelect} from 'element-plus';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ProductAssetCatalog from '../products/ProductAssetCatalog.vue';
import ProductAssetGraph from '../products/ProductAssetGraph.vue';
import {productGraph} from '@ontomato/contracts/product-graph';
import {installObjectViewHost} from './object-view-host';

/**
 * A product profile names an agent of this domain and points nowhere else: the platform's agent settings have the agent,
 * and authorisation names the members and roles that may use the product. The editor offers the domain's agents by name
 * rather than a text field for an identifier, and the graph calls a granted member a member.
 */
/** The agent directory's own answer: what the platform's `/assistant/agents` returns, effective skills included. */
const AGENTS=[
  {id:'11111111-1111-4111-8111-111111111111',name:'Assistant',description:'Answers business questions',icon:null,enabled:true,effectiveSkills:[]},
  {id:'22222222-2222-4222-8222-222222222222',name:'Analyst',description:'Investigates the numbers',icon:null,enabled:true,effectiveSkills:[]},
];
let app:App|undefined;
afterEach(()=>{app?.unmount();app=undefined;document.body.innerHTML='';vi.unstubAllGlobals();});

function installElement(target:App){for(const component of [ElButton,ElFormItem,ElInput,ElSelect,ElOption,ElInputNumber])target.component(component.name!,component);}
const settle=async()=>{for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};
const findButton=(scope:ParentNode,text:string)=>Array.from(scope.querySelectorAll('button')).find(item=>item.textContent?.trim()===text) as HTMLButtonElement|undefined;

const profile=productAssetSchema.parse({
  id:'profile-1',ownerId:'author',name:'Default agent profile',description:'',visibility:'domain',revision:1,editable:true,
  createdAt:'now',updatedAt:'now',
  document:{kind:'agent-profile',agentId:AGENTS[0]!.id,instructions:'Be brief.',tools:[],contextViews:[]},
});

function served(){return vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{
  if(url.endsWith('/native-binding'))return Response.json({agentId:AGENTS[0]!.id});
  if(url.includes('/assistant/agents'))return Response.json({agents:AGENTS});
  if(init.method==='PUT'){const body=JSON.parse(String(init.body));return Response.json({asset:{...body,id:'profile-1',ownerId:'author',revision:2,createdAt:'now',updatedAt:'now',editable:true}});}
  if(url.endsWith('/releases'))return Response.json({releases:[]});
  if(url.includes('/product-assets/profile-1'))return Response.json({asset:profile});
  return Response.json({success:true,data:{items:[],total:0}});
});}

async function edit(){
  served();
  const element=document.createElement('div');document.body.append(element);
  app=createApp({render:()=>h(ProductAssetCatalog,{assetId:'profile-1'})});
  installElement(app);installObjectViewHost(app);app.mount(element);
  await settle();
  findButton(element,'Edit')!.click();
  await settle();
  return element;
}

describe("a profile's referenced agent",()=>{
  it("is chosen from this domain's agents by name, not typed as an identifier",async()=>{
    const element=await edit();

    const field=Array.from(element.querySelectorAll('.el-form-item')).find(item=>item.textContent?.startsWith('Referenced agent'))!;
    // The whole field is a choice, as the page's other references are: no text field for an id.
    expect(field.querySelector('.el-select')).not.toBeNull();
    expect(field.querySelector('input.el-input__inner')).toBeNull();
    // It reads the domain's agents by name; the id stays the value that is saved.
    // Its choice, and the caret that says so, where the profile's other references have one.
    expect(field.querySelector('.el-select__placeholder span')?.textContent).toBe('Assistant');
    expect(field.querySelector('.el-select__suffix svg')).not.toBeNull();
    expect(field.textContent).toContain('Referenced agent');
  });
});

describe("reading this domain's agents",()=>{
  it("shows the server's reason when the list cannot be read, and reads again on retry",async()=>{
    served();
    const fetchMock=globalThis.fetch as unknown as (url:string,init?:RequestInit)=>Promise<Response>;
    // The directory refuses until the reader asks again.
    let refusing=true;
    vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{
      if(url.includes('/assistant/agents')&&refusing)return Response.json({error:{message:'The agent directory is unavailable'}},{status:503});
      return fetchMock(url,init);
    });
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetCatalog,{assetId:'profile-1'})});
    installElement(app);installObjectViewHost(app);app.mount(element);
    await settle();
    findButton(element,'Edit')!.click();
    await settle();

    const field=Array.from(element.querySelectorAll('.el-form-item')).find(item=>item.textContent?.startsWith('Referenced agent'))!;
    // The reader is told why, in the service's own words, and can ask again.
    const alert=field.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Couldn't read this domain's agents:");
    expect(alert.textContent).toContain('The agent directory is unavailable');
    refusing=false;
    findButton(alert,'Retry')!.click();
    await settle();
    // Read again, the list is what the choice offers.
    expect(Array.from(element.querySelectorAll('.el-select__wrapper')).some(item=>item.textContent?.includes('Assistant'))).toBe(true);
  });
});

describe('a granted member in a product graph',()=>{
  it('is called a member, as the list and the legend call it',async()=>{
    const graph=productGraph([profile]);
    graph.nodes.push({id:'grant:principal:someone',name:'someone',kind:'principal',category:'principal'});
    graph.edges.push({source:'grant:principal:someone',target:'asset:profile-1',relation:'use',storage:'governance'});
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetGraph,{graph})});installElement(app);installObjectViewHost(app);app.mount(element);
    await settle();

    expect(element.textContent).toContain('Member');
    expect(element.textContent).not.toContain('Principal');
  });
});
