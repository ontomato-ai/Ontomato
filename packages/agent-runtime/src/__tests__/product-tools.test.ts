import {afterEach,expect,it,vi} from 'vitest';
import {productTools} from '../product-tools';
import type {RuntimeStartRunRequest} from '@ontomato/contracts/agent-runtime';
import {runtimeAgentDefinitionSchema} from '@ontomato/contracts/agent-runtime';
afterEach(()=>{vi.unstubAllGlobals();});
it('calls the frozen host tool endpoint with its run-scoped delegation and reports authorization failures',async()=>{
  const request={definition:{productTools:[{name:'product_count',description:'Count',inputSchema:{type:'object'},path:'/api/product-assets/profile/releases/12345678-1234-1234-1234-123456789012/tools/count'}]},environment:{values:{ONTOMATO_WORKBENCH_URL:'http://workbench.test'},secrets:{ONTOMATO_PRODUCT_CALLBACK:'sealed-callback'}}} as unknown as RuntimeStartRunRequest;
  const fetch=vi.fn(async(_url:URL,_init:Parameters<typeof globalThis.fetch>[1])=>Response.json({error:{code:'PRODUCT_FORBIDDEN'}},{status:403}));vi.stubGlobal('fetch',fetch);
  const tool=productTools(request,'run-id')[0];
  const result=await tool.execute('call',{year:2026},new AbortController().signal);
  expect(result.isError).toBe(true);
  expect(fetch.mock.calls[0][0]).toBeInstanceOf(URL);
  const init=fetch.mock.calls[0][1]!;
  expect(new Headers(init.headers).get('tk')).toBe('sealed-callback');
  expect(new Headers(init.headers).get('X-Ontomato-Run-Id')).toBe('run-id');
  expect(JSON.parse(String(init.body))).toEqual({parameters:{year:2026}});
  expect(fetch).toHaveBeenCalledTimes(1);
  request.environment.values.ONTOMATO_WORKBENCH_URL='http://workbench.test/deployment';
  await productTools(request,'run-id')[0].execute('call',{},new AbortController().signal);
  expect(String(fetch.mock.calls[1][0])).toContain('/deployment/api/product-assets/');
});
it('rejects inherited execution tools on an explicitly product-only tool surface',()=>{
  const definition={systemPrompt:'',modelId:null,skills:[],sandbox:{limits:{memoryBytes:1_000_000_000,wallTimeMs:60_000,cpuSeconds:60}},externalMcp:[],toolSurface:'product',productTools:[],compaction:{systemPrompt:'',summarizePrompt:'',updatePrompt:''}};
  expect(runtimeAgentDefinitionSchema.safeParse(definition).success).toBe(true);
  expect(runtimeAgentDefinitionSchema.safeParse({...definition,externalMcp:[{id:'inherited'}]}).success).toBe(false);
});
