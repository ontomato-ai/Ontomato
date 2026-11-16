import {expect,it} from 'vitest';
import {applicationShortcuts} from '../application-shortcuts';
import type {PlatformAppDeclaration} from '../apps';
it('bounds personal dynamic shortcuts while preserving the active application and builtins',()=>{
  const app=(id:string):PlatformAppDeclaration=>({id,label:id,icon:'pages',category:'business',prefix:'/'+id});
  const dynamic=Array.from({length:12},(_,index)=>`app-${index}`);
  const shown=applicationShortcuts(['home','application-gallery',...dynamic].map(app),dynamic,dynamic,'app-11');
  expect(shown.filter(item=>dynamic.includes(item.id))).toHaveLength(6);
  expect(shown.map(item=>item.id)).toEqual(expect.arrayContaining(['home','application-gallery','app-11']));
  expect(shown.some(item=>item.id==='app-8')).toBe(false);
});
