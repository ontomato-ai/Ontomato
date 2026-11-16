import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {registerPlatformObject,readPlatformObjects,withPlatformProjectionPreferences,platformProjectionPreferences} from '../platform-objects';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';
it('passes the captured subject to providers and projects only registered fields',async()=>{
  const read=vi.fn(async()=>[{id:'one',title:'Mine',privateInternal:'hidden'}]);
  registerPlatformObject({objectType:'platform:AcceptanceObject',name:'Acceptance',fields:{id:'string',title:'string'},parameters:z.object({}).strict(),read});
  const owner={domainId:'domain',userId:'reader'},credentials={token:'current'};
  await expect(readPlatformObjects(owner,credentials,'platform:AcceptanceObject',{},['id','title'])).resolves.toEqual([{id:'one',title:'Mine'}]);
  expect(read).toHaveBeenCalledWith(owner,credentials,{});
  await expect(readPlatformObjects(owner,credentials,'platform:AcceptanceObject',{},['privateInternal'])).rejects.toMatchObject({code:'INVALID_PRODUCT_FIELD'});
  await expect(readPlatformObjects(owner,credentials,'platform:AcceptanceObject',{userId:'another'},['id'])).rejects.toThrow();
  expect(()=>registerPlatformObject({objectType:'platform:AcceptanceObject',name:'Duplicate',fields:{},parameters:z.object({}),read})).toThrow();
});
it('isolates projection preferences across concurrent principal reads',async()=>{
  const first={...defaultPersonalWorkspace(),applicationIds:['one']},second={...defaultPersonalWorkspace(),applicationIds:['two']};
  const read=async()=>{await Promise.resolve();return platformProjectionPreferences()?.applicationIds;};
  expect(await Promise.all([withPlatformProjectionPreferences(first,read),withPlatformProjectionPreferences(second,read)])).toEqual([['one'],['two']]);
  expect(platformProjectionPreferences()).toBeUndefined();
});
it('rejects provider values that do not match the registered field contract',async()=>{
  registerPlatformObject({objectType:'platform:InvalidAcceptanceObject',name:'Invalid',fields:{id:'string',paused:'boolean'},parameters:z.object({}).strict(),read:async()=>[{id:'one',paused:{reason:'blocked'}}]});
  await expect(readPlatformObjects({domainId:'domain',userId:'reader'},{},'platform:InvalidAcceptanceObject',{},['id','paused'])).rejects.toMatchObject({code:'INVALID_PLATFORM_OBJECT_RESPONSE'});
});
