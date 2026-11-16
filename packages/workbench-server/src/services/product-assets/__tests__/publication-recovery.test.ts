import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const state=vi.hoisted(()=>({baseUrl:'',pending:true,fail:true,received:[] as unknown[],query:vi.fn(),asset:undefined as unknown}));
vi.mock('../../../i18n',()=>({getLocale:()=> 'en',tApp:(key:string)=>key}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{get baseUrl(){return state.baseUrl;}}}}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:state.query})}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(client:{query:typeof state.query})=>unknown)=>{const pending=state.pending;try{return await action({query:state.query});}catch(error){state.pending=pending;throw error;}}}));
vi.mock('../store',()=>({lockProducts:async()=>{},getProduct:async()=>state.asset}));
import {synchronizeBundlePublication,releaseSnapshotSchema} from '../releases';
let server:Server;
beforeEach(async()=>{
  state.pending=true;state.fail=true;state.received=[];
  const frozen=productAssetSchema.parse({id:'app-recovery',name:'Frozen publication',description:'',ownerId:'author',visibility:'private',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'application',applicationId:'app-recovery',children:[]}});
  state.asset={...frozen,name:'Later draft',revision:2,editable:true};
  const snapshot=releaseSnapshotSchema.parse({schemaVersion:1,roots:[frozen.id],assets:[frozen],contracts:[]});
  state.query.mockImplementation(async(sql:string)=>{
    if(sql.startsWith('DELETE FROM product_publication_outbox')){state.pending=false;return {rows:[]};}
    if(sql.includes('FROM product_publication_outbox'))return {rows:state.pending?[{release_id:'frozen-release'}]:[]};
    if(sql.includes('SELECT snapshot'))return {rows:[{snapshot}]};
    return {rows:[]};
  });
  server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    state.received.push({method:request.method,path:request.url,body:JSON.parse(body)});
    response.writeHead(state.fail?503:200,{'Content-Type':'application/json'});
    response.end(JSON.stringify({success:!state.fail}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  state.baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
it('recovers after an actual directory HTTP failure while preserving the frozen release and declaration',async()=>{
  const owner={domainId:'test',userId:'author'};
  await expect(synchronizeBundlePublication(owner,'app-recovery',{})).rejects.toThrow();
  expect(state.pending).toBe(true);
  state.fail=false;
  await synchronizeBundlePublication(owner,'app-recovery',{});
  expect(state.pending).toBe(false);
  expect(state.received).toEqual(expect.arrayContaining([expect.objectContaining({method:'PUT',path:'/platform/applications/app-recovery/product-publication',body:expect.objectContaining({releaseId:'frozen-release',declaration:expect.objectContaining({names:{en:'Frozen publication'}})})})]));
  const attempts=state.received.length;
  await synchronizeBundlePublication(owner,'app-recovery',{});
  expect(state.received).toHaveLength(attempts);
});
