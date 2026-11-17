import {beforeEach,describe,expect,it,vi} from 'vitest';
import {productAssetInputSchema,productQuerySchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({query:vi.fn(),validate:vi.fn()}));
const access=vi.hoisted(()=>({use:new Set<string>(),edit:new Set<string>()}));
vi.mock('../grants',()=>({withProductGrants:async(_owner:unknown,action:()=>unknown)=>action(),currentProductGrants:()=>access,registerProductResource:async(_owner:unknown,id:string)=>{access.use.add(id);access.edit.add(id);},productGrantIdsForOwner:async(_owner:unknown,verb:string)=>[...access[verb==='edit'?'edit':'use']],shareProductResource:vi.fn(),refreshProductGrants:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:mocks.query})}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(fn:(client:{query:typeof mocks.query})=>unknown)=>fn({query:mocks.query})}));
vi.mock('../validation',()=>({validateProduct:mocks.validate,validatePageBindings:vi.fn()}));
vi.mock('../ontology',()=>({ontologyRegistration:()=>null,synchronizeProductOntology:async()=>{}}));
import {saveProduct,getApplicationProduct} from '../store';
const owner={domainId:'one',userId:'alice'},credentials={token:'test-caller'};
const input=()=>productAssetInputSchema.parse({name:'Text',document:{kind:'widget',widget:{id:'text',kind:'text',title:'Note',span:12,text:'Hello'}}});
beforeEach(()=>{mocks.query.mockReset();mocks.validate.mockReset();access.use=new Set(['shared','home','hidden','chart']);access.edit=new Set(['home','chart']);});
describe('product mutation boundary',()=>{
  it('resolves imported application identities using only use grants',async()=>{
    access.use.add('imported');access.edit.add('edit-only');
    mocks.query.mockImplementation(async(sql:string,args:unknown[])=>{
      if(sql.startsWith('SELECT id FROM')){
        expect(args[0]).toBe(owner.domainId);
        expect(args[2]).toContain('imported');
        expect(args[2]).not.toContain('edit-only');
        return {rows:[{id:'imported'}]};
      }
      return {rows:[{id:'imported',ownerId:'alice',name:'App',description:'',visibility:'private',document:{kind:'application',applicationId:'app-original',children:[]},revision:1,createdAt:new Date(),updatedAt:new Date()}]};
    });
    expect((await getApplicationProduct(owner,'app-original')).id).toBe('imported');
  });
  it('rejects unavailable or ambiguous application identities',async()=>{
    mocks.query.mockResolvedValue({rows:[]});
    await expect(getApplicationProduct(owner,'missing')).rejects.toMatchObject({code:'PRODUCT_UNAVAILABLE'});
    mocks.query.mockResolvedValue({rows:[{id:'one'},{id:'two'}]});
    await expect(getApplicationProduct(owner,'ambiguous')).rejects.toMatchObject({code:'PRODUCT_CONFLICT'});
  });
  it('creates new homes from Page and CollectionView documents without closed platform widgets',async()=>{
    const records=new Map<string,Record<string,unknown>>(),overlays=new Map<string,unknown>();
    mocks.query.mockImplementation(async(sql:string,args:unknown[]=[])=>{
      if(sql.includes('INSERT INTO product_user_overlays')){overlays.set(String(args[2]),JSON.parse(String(args[3])));return {rows:[]};}
      if(sql.includes('INSERT INTO product_assets')){const previous=records.get(String(args[1]));records.set(String(args[1]),{id:args[1],ownerId:args[2],name:args[3],description:args[4],visibility:args[5],document:JSON.parse(String(args[6])),revision:Number(previous?.revision??0)+1,createdAt:new Date(),updatedAt:new Date()});return {rows:[]};}
      if(sql.includes('SELECT owner_id,revision')){const record=records.get(String(args[1]));return {rows:record?[{owner_id:record.ownerId,revision:record.revision,document:record.document,visibility:record.visibility}]:[]};}
      if(sql.includes('SELECT id, owner_id'))return {rows:records.has(String(args[1]))?[records.get(String(args[1]))]:[]};
      if(sql.includes('SELECT preferences'))return {rows:overlays.has(String(args[2]))?[{preferences:overlays.get(String(args[2]))}]:[]};
      return {rows:[]};
    });
    const {personalHome}=await import('../store');
    const home=await personalHome(owner,credentials);
    expect(home.document.kind).toBe('page');
    expect([...records.values()].some(record=>(record.document as {kind:string}).kind==='widget')).toBe(false);
    expect([...records.values()].some(record=>(record.document as {kind:string}).kind==='collection-view')).toBe(true);
    expect(home.document).not.toHaveProperty('workspace');
  });
  it('does not reuse a deleted identity whose revisions remain referenced by history',async()=>{
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM product_asset_revisions')?[{exists:1}]:[]}));
    await expect(saveProduct(owner,'retired',input(),0,credentials)).rejects.toMatchObject({code:'PRODUCT_ID_RETIRED'});
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it('rejects an asset without any use or edit Grant before reading its document',async()=>{
    access.use.clear();access.edit.clear();
    const {getProduct}=await import('../store');
    await expect(getProduct(owner,'shared')).rejects.toMatchObject({code:'PRODUCT_UNAVAILABLE'});
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('allows a delegated editor to update another authors presentation without changing ownership',async()=>{
    access.use.add('delegated');access.edit.add('delegated');
    const document=input().document;
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'bob',revision:1,document,visibility:'private'}]:sql.includes('SELECT id, owner_id')?[{id:'delegated',ownerId:'bob',name:'Text',description:'',visibility:'private',document,revision:2,createdAt:new Date(),updatedAt:new Date()}]:[]}));
    const result=await saveProduct(owner,'delegated',input(),1,credentials);
    expect(result).toMatchObject({ownerId:'bob',editable:true,revision:2});
    const write=mocks.query.mock.calls.find(([sql])=>sql.includes('ON CONFLICT(domain_id,id) DO UPDATE'))!;
    expect(write[0].split('DO UPDATE')[1]).not.toContain('owner_id=');
  });
  it('does not mutate governance when a compatibility visibility value changes during a definition save',async()=>{
    access.edit.add('shared');
    const document=input().document;
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'bob',revision:1,document,visibility:'domain'}]:sql.includes('SELECT id, owner_id')?[{id:'shared',ownerId:'bob',name:'Text',description:'',visibility:'private',document,revision:2,createdAt:new Date(),updatedAt:new Date()}]:[]}));
    await saveProduct(owner,'shared',input(),1,credentials);
    const {shareProductResource}=await import('../grants');
    expect(shareProductResource).not.toHaveBeenCalled();
  });
  it('does not retain the authors implicit edit permission after its Grant is revoked',async()=>{
    access.edit.delete('home');
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id')?[{owner_id:'alice',revision:1}]:[]}));
    await expect(saveProduct(owner,'home',input(),1,credentials)).rejects.toMatchObject({code:'PRODUCT_FORBIDDEN'});
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it('stores personal preferences under the current principal without changing the shared page',async()=>{
    const page={id:'shared',ownerId:'bob',name:'Shared',description:'',visibility:'domain',revision:8,createdAt:new Date(),updatedAt:new Date(),document:{kind:'page',compositionVersion:2,workspace:{schemaVersion:1,layout:'data',dashboardIds:[],applicationIds:[]},children:[]}};
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT id, owner_id')?[page]:[]}));
    const {saveProductOverlay}=await import('../store');
    const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
    await expect(saveProductOverlay(owner,'shared',defaultPersonalWorkspace(),0)).resolves.toMatchObject({revision:1});
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO product_user_overlays'))).toBe(true);
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('UPDATE product_assets'))).toBe(false);
    const write=mocks.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO product_user_overlays'))!;
    expect(write[1].slice(0,3)).toEqual(['one','alice','shared']);
  });
  it('propagates home resource preferences only to directly referenced platform collections for the same principal',async()=>{
    const page={id:'shared',ownerId:'bob',name:'Shared',description:'',visibility:'domain',revision:8,createdAt:new Date(),updatedAt:new Date(),document:{kind:'page',children:[{assetId:'apps',column:'main'}]}};
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT id, owner_id')?[page]:[]}));
    const {saveProductOverlay}=await import('../store');const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
    await saveProductOverlay(owner,'shared',{...defaultPersonalWorkspace(),applicationIds:['selected']},0);
    const propagation=mocks.query.mock.calls.find(([sql])=>sql.includes('projection.id=ANY'))!;
    expect(propagation[1].slice(0,3)).toEqual(['one','alice',['apps']]);
    expect(propagation[0]).toContain("projection.document->>'kind'='collection-view'");
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('UPDATE product_assets'))).toBe(false);
  });
  it('extracts legacy page preferences for the author and persists only composition fields',async()=>{
    const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
    const candidate=productAssetInputSchema.parse({name:'Shared',document:{kind:'page',workspace:defaultPersonalWorkspace(),children:[]}});
    access.edit.add('shared');
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'bob',revision:1,document:candidate.document,visibility:'private'}]:sql.includes('SELECT id, owner_id')?[{id:'shared',ownerId:'bob',name:'Shared',description:'',visibility:'private',document:{kind:'page',children:[]},revision:2,createdAt:new Date(),updatedAt:new Date()}]:[]}));
    await saveProduct(owner,'shared',candidate,1,credentials);
    const overlay=mocks.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO product_user_overlays'))!;
    expect(overlay[1].slice(0,3)).toEqual(['one','bob','shared']);
    const write=mocks.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO product_assets'))!;
    expect(JSON.parse(write[1][6])).not.toHaveProperty('workspace');
  });
  it('does not let a delegated Page editor seed another principals preferences through a legacy input',async()=>{
    const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
    const candidate=productAssetInputSchema.parse({name:'Shared',document:{kind:'page',workspace:{...defaultPersonalWorkspace(),applicationIds:['injected']},children:[]}});
    access.edit.add('shared');
    const document={kind:'page',children:[]};
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'bob',revision:1,document,visibility:'private'}]:sql.includes('SELECT id, owner_id')?[{id:'shared',ownerId:'bob',name:'Shared',description:'',visibility:'private',document,revision:2,createdAt:new Date(),updatedAt:new Date()}]:[]}));
    await saveProduct(owner,'shared',candidate,1,credentials);
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO product_user_overlays'))).toBe(false);
  });
  it('returns content metadata for only the visible paginated assets without including documents',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{total:1}]}).mockResolvedValueOnce({rows:[{id:'chart',ownerId:'alice',name:'Chart',kind:'metric-widget',createdAt:new Date(),updatedAt:new Date()}]}).mockResolvedValueOnce({rows:[{id:'chart',details:{renderer:'chart'}}]});
    const {queryProducts}=await import('../store');
    const result=await queryProducts(owner,productQuerySchema.parse({kind:'metric-widget'}));
    expect(result.items[0].details).toEqual({renderer:'chart'});
    expect(result.items[0]).not.toHaveProperty('document');
    expect(mocks.query.mock.calls[2][1]).toEqual(['one',['chart']]);
  });
  it('keeps an explicitly empty asset composition empty on subsequent home reads',async()=>{
    const document={kind:'page',compositionVersion:2,workspace:{schemaVersion:1,layout:'data',dashboardIds:[],applicationIds:[]},children:[]};
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT asset_id')?[{asset_id:'home'}]:sql.includes('SELECT id, owner_id')?[{id:'home',ownerId:'alice',name:'Home',description:'',visibility:'private',document,revision:1,createdAt:new Date(),updatedAt:new Date()}]:[]}));
    const {personalHome}=await import('../store');
    const result=await personalHome(owner,credentials);
    expect(result.document).toMatchObject({compositionVersion:2,children:[]});
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
  });
  it('filters template pages and orders the entire visible result before pagination',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{total:0}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
    const {queryProducts}=await import('../store');
    await queryProducts(owner,productQuerySchema.parse({kind:'page',pageForm:'template',sort:'name',page:2,pageSize:20}));
    for(const [sql] of mocks.query.mock.calls.slice(0,2)){
      expect(sql).toContain("document->>'isTemplate'='true'");
      expect(sql).toContain('domain_id=$1 AND id=ANY($2::text[])');
    }
    const [sql,args]=mocks.query.mock.calls[1];
    expect(sql).toContain('ORDER BY lower(name),id LIMIT');
    expect(args.slice(-2)).toEqual([20,20]);
  });
  it('applies structural ordering before pagination while keeping recent-update ordering explicit',async()=>{
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('count(*)::int AS total')?[{total:0}]:[]}));
    const {queryProducts}=await import('../store');
    await queryProducts(owner,productQuerySchema.parse({page:2}));
    const [sql,args]=mocks.query.mock.calls.find(([sql])=>sql.includes('ORDER BY')&&sql.includes('LIMIT'))!;
    expect(sql).toContain("CASE document->>'kind'");
    expect(sql).toContain("document->>'isTemplate'='true' THEN 2");
    expect(args.slice(-2)).toEqual([20,20]);
    mocks.query.mockClear();
    await queryProducts(owner,productQuerySchema.parse({sort:'updated'}));
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('ORDER BY updated_at DESC,id LIMIT'))).toBe(true);
  });
  it('paginates name search inside the caller-visible domain and shared scope',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{total:65}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
    const {queryProducts}=await import('../store');
    const result=await queryProducts(owner,productQuerySchema.parse({search:'Revenue',scope:'shared',kind:'widget',page:3,pageSize:20}));
    expect(result.total).toBe(65);
    const [sql,args]=mocks.query.mock.calls[1];
    expect(sql).toContain('domain_id=$1 AND id=ANY($2::text[])');
    expect(args).toEqual(['one',['shared','home','hidden','chart'],'alice','widget','Revenue',20,40]);
    expect(sql).not.toContain('SELECT document,');
  });
  it('rejects non-owner writes before capability admission or persistence',async()=>{
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id')?[{owner_id:'bob',revision:1}]:[]}));
    await expect(saveProduct(owner,'private',input(),1,credentials)).rejects.toMatchObject({status:403,code:'PRODUCT_FORBIDDEN'});
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
  });
  it('checks capability admission inside the common save service',async()=>{
    mocks.query.mockResolvedValue({rows:[]});
    mocks.validate.mockRejectedValue(Object.assign(new Error('Unavailable'),{code:'UNPUBLISHED_CAPABILITY'}));
    await expect(saveProduct(owner,'new',input(),0,credentials)).rejects.toMatchObject({code:'UNPUBLISHED_CAPABILITY'});
    expect(mocks.validate).toHaveBeenCalledWith(owner,input(),credentials);
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
  });
  it('does not return private assets from another owner or domain',async()=>{
    mocks.query.mockResolvedValue({rows:[]});
    const {getProduct}=await import('../store');
    await expect(getProduct(owner,'hidden')).rejects.toMatchObject({status:404});
    const [sql,args]=mocks.query.mock.calls[0];
    expect(sql).toContain('domain_id=$1 AND id=$2');
    expect(args).toEqual(['one','hidden']);
  });
});
