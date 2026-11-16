import {expect,it} from 'vitest';
import {profileRuntimeTools} from '../runtime-tools';
import {runtimeProductToolSchema} from '@ontomato/contracts/agent-runtime-product-tools';
it('exposes declared parameter types and pins callback paths to the selected release',()=>{
  const profile={id:'profile',releaseId:'12345678-1234-1234-1234-123456789012',principalId:'agent',instructions:'',contextViews:[],tools:[{assetId:'metric',kind:'metric' as const,id:'count',name:'Count',description:'Published count',parameters:[{name:'year',type:'TYPE_NUMBER'},{name:'regions',type:'TYPE_STRING_ARRAY'}],outputs:[]}]};
  const tool=profileRuntimeTools(profile)[0];
  expect(runtimeProductToolSchema.safeParse(tool).success).toBe(true);
  expect(tool.inputSchema).toMatchObject({properties:{year:{type:'number'},regions:{type:'array',items:{type:'string'}}},additionalProperties:false});
  expect(tool.path).toContain('/releases/'+profile.releaseId+'/tools/metric');
  expect(profileRuntimeTools(profile)[0].name).toBe(tool.name);
  const scoped=profileRuntimeTools(profile,'12345678-1234-1234-1234-123456789012')[0];
  expect(runtimeProductToolSchema.safeParse(scoped).success).toBe(true);
  expect(scoped.path).toContain('?sessionId=');
});
