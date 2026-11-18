import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({execute:vi.fn(),trigger:vi.fn(),grant:vi.fn(),query:vi.fn<[string,...unknown[]],Promise<{rows:Record<string,unknown>[]}>>(async()=>({rows:[]}))}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../definitions',()=>({executeDefinition:mocks.execute}));
vi.mock('../triggers',()=>({readDefinitionTrigger:mocks.trigger}));
vi.mock('../grants',()=>({requireProductGrant:mocks.grant}));
import {subscribeProduct,pollProductSubscription,unsubscribeProduct,resumeProductSubscription,deleteProductSubscription,notifyProductDefinitionChanged} from '../subscriptions';
const owner={domainId:'domain',userId:'reader'};
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks();});
it('delivers identity-only current-definition notifications through product queues without business evaluation',async()=>{
  vi.useFakeTimers();
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT id,domain_id')?[{id:'p'}]:[]}));
  const subscription=await subscribeProduct(owner,{token:'current'},{kind:'product-definition',target:{kind:'panel',id:'p'}});
  await notifyProductDefinitionChanged({kind:'definition-changed',domainId:'other',target:{kind:'panel',id:'p'}});
  expect(pollProductSubscription(owner,subscription.id).events).toEqual([]);
  const event={kind:'definition-changed',domainId:owner.domainId,target:{kind:'panel',id:'p'}} as const;
  await notifyProductDefinitionChanged(event);
  expect((await resumeProductSubscription(owner,subscription.id,{token:'new'})).events).toEqual([event]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.execute).not.toHaveBeenCalled();expect(mocks.trigger).not.toHaveBeenCalled();
  mocks.grant.mockRejectedValue(new Error('Product use revoked'));
  await expect(resumeProductSubscription(owner,subscription.id,{token:'revoked'})).rejects.toThrow('Product use revoked');
  await vi.advanceTimersByTimeAsync(10_000);
});
it('restores persisted product-definition events without interpreting them as business Trigger state',async()=>{
  vi.useFakeTimers();
  const event={kind:'definition-changed',domainId:owner.domainId,target:{kind:'projection',id:'x'}} as const;
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT target')?
    [{target:{kind:'product-definition',target:{kind:'projection',id:'x'}},state:{members:[],events:[event]},expires_at:new Date(Date.now()+30_000)}]
    :sql.startsWith('SELECT id,domain_id')?[{id:'x'}]:[]}));
  expect((await resumeProductSubscription(owner,'restored-definition',{token:'current'})).events).toEqual([event]);
  expect(mocks.execute).not.toHaveBeenCalled();expect(mocks.trigger).not.toHaveBeenCalled();
  unsubscribeProduct(owner,'restored-definition');await vi.advanceTimersByTimeAsync(10_000);
});
it('evaluates on the server and delivers only fired changes to the owning principal',async()=>{
  vi.useFakeTimers();
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'one'}]});
  const subscription=await subscribeProduct(owner,{token:'current'},{kind:'definition',id:'members',parameters:{},fields:['id']});
  expect(pollProductSubscription(owner,subscription.id).events).toEqual([]);
  expect(()=>pollProductSubscription({...owner,userId:'another'},subscription.id)).toThrow();
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'two'}]});
  await vi.advanceTimersByTimeAsync(10_000);
  expect(pollProductSubscription(owner,subscription.id).events).toMatchObject([{kind:'changed',targetId:'members'}]);
  expect(pollProductSubscription(owner,subscription.id).events).toEqual([]);
  unsubscribeProduct(owner,subscription.id);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(()=>pollProductSubscription(owner,subscription.id)).toThrow();
});
it('ends a subscription after authorization or execution fails instead of serving stale events',async()=>{
  vi.useFakeTimers();mocks.execute.mockResolvedValue({revision:1,rows:[]});
  const subscription=await subscribeProduct(owner,{}, {kind:'definition',id:'members',parameters:{},fields:['id']});
  mocks.execute.mockRejectedValue(new Error('Permission revoked'));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(()=>pollProductSubscription(owner,subscription.id)).toThrow();
  await vi.advanceTimersByTimeAsync(10_000);
});
it('includes later result pages when detecting collection changes',async()=>{
  vi.useFakeTimers();
  const firstPage=Array.from({length:50},(_,index)=>({id:String(index)}));
  let last='before';
  mocks.execute.mockImplementation(async(_owner,_credentials,_id,_parameters,_fields,offset)=>({revision:1,rows:offset===0?firstPage:[{id:last}]}));
  const subscription=await subscribeProduct(owner,{}, {kind:'definition',id:'members',parameters:{},fields:['id']});
  last='after';
  await vi.advanceTimersByTimeAsync(10_000);
  expect(pollProductSubscription(owner,subscription.id).events).toHaveLength(1);
  unsubscribeProduct(owner,subscription.id);await vi.advanceTimersByTimeAsync(10_000);
});
it('fires Trigger entry events on the server without asking the page to compare membership',async()=>{
  vi.useFakeTimers();
  mocks.trigger.mockResolvedValue({id:'new-members',definitionId:'members',event:'entered',keyField:'id'});
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'one'}]});
  const subscription=await subscribeProduct(owner,{}, {kind:'trigger',id:'new-members',parameters:{}});
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'one'},{id:'two'}]});
  await vi.advanceTimersByTimeAsync(10_000);
  expect(pollProductSubscription(owner,subscription.id).events).toMatchObject([{kind:'entered',targetId:'new-members',memberKeys:['two']}]);
  unsubscribeProduct(owner,subscription.id);await vi.advanceTimersByTimeAsync(10_000);
});
it('does not fire membership Triggers when only result ordering changes',async()=>{
  vi.useFakeTimers();mocks.trigger.mockResolvedValue({id:'members-changed',definitionId:'members',event:'changed',keyField:'id'});
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'one'},{id:'two'}]});
  const subscription=await subscribeProduct(owner,{}, {kind:'trigger',id:'members-changed',parameters:{}});
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'two'},{id:'one'}]});await vi.advanceTimersByTimeAsync(10_000);
  expect(pollProductSubscription(owner,subscription.id).events).toEqual([]);
  unsubscribeProduct(owner,subscription.id);await vi.advanceTimersByTimeAsync(10_000);
});
it('resumes persisted state with the current callers credentials and never persists those credentials',async()=>{
  vi.useFakeTimers();
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT target')?[{target:{kind:'definition',id:'members',parameters:{},fields:['id']},state:{fingerprint:'before-restart',members:[],events:[]},expires_at:new Date(Date.now()+30_000)}]:[]}));
  mocks.execute.mockResolvedValue({revision:1,rows:[{id:'new'}]});
  const result=await resumeProductSubscription(owner,'restored',{token:'new-token'});
  expect(result.events).toMatchObject([{targetId:'members',kind:'changed'}]);
  expect(mocks.execute).toHaveBeenCalledWith(owner,{token:'new-token'},'members',{},['id'],0);
  expect(JSON.stringify(mocks.query.mock.calls)).not.toContain('new-token');
  unsubscribeProduct(owner,'restored');await vi.advanceTimersByTimeAsync(10_000);
});
it('does not recreate a cancelled subscription when an in-flight evaluation completes',async()=>{
  vi.useFakeTimers();mocks.execute.mockResolvedValue({revision:1,rows:[]});
  const subscription=await subscribeProduct(owner,{}, {kind:'definition',id:'members',parameters:{},fields:['id']});
  let complete!:(value:unknown)=>void;
  mocks.execute.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const polling=resumeProductSubscription(owner,subscription.id,{});
  await Promise.resolve();
  await deleteProductSubscription(owner,subscription.id);
  mocks.query.mockClear();complete({revision:1,rows:[{id:'changed'}]});
  await expect(polling).rejects.toMatchObject({code:'SUBSCRIPTION_UNAVAILABLE'});
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO product_subscriptions'))).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
});
