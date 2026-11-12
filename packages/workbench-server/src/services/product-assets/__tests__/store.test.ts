import {beforeEach,describe,expect,it,vi} from 'vitest';
import {productAssetInputSchema,productQuerySchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({query:vi.fn(),validate:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:mocks.query})}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(fn:(client:{query:typeof mocks.query})=>unknown)=>fn({query:mocks.query})}));
vi.mock('../validation',()=>({validateProduct:mocks.validate}));
import {saveProduct} from '../store';
const owner={domainId:'one',userId:'alice'},credentials={token:'test-caller'};
const input=()=>productAssetInputSchema.parse({name:'Text',document:{kind:'widget',widget:{id:'text',kind:'text',title:'Note',span:12,text:'Hello'}}});
beforeEach(()=>{mocks.query.mockReset();mocks.validate.mockReset();});
describe('product mutation boundary',()=>{
  it('paginates name search inside the caller-visible domain and shared scope',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{total:65}]}).mockResolvedValueOnce({rows:[]});
    const {queryProducts}=await import('../store');
    const result=await queryProducts(owner,productQuerySchema.parse({search:'Revenue',scope:'shared',kind:'widget',page:3,pageSize:20}));
    expect(result.total).toBe(65);
    const [sql,args]=mocks.query.mock.calls[1];
    expect(sql).toContain("domain_id=$1 AND (owner_id=$2 OR visibility='domain')");
    expect(args).toEqual(['one','alice','widget','Revenue',20,40]);
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
    expect(sql).toContain("domain_id=$1 AND id=$2 AND (owner_id=$3 OR visibility='domain')");
    expect(args).toEqual(['one','hidden','alice']);
  });
});
