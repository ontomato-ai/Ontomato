import {describe,expect,it} from 'vitest';
import {homeItems} from '../features/home/items';
import type {PlatformAppDeclaration} from '../apps';

describe('gallery discovery',()=>{
  it('excludes home aliases and the gallery itself while retaining business entries',()=>{
    const app=(id:string):PlatformAppDeclaration=>({id,label:id,icon:'pages',category:'business',prefix:'/'+id});
    const items=homeItems(['home','personal-workspace','workplace','application-gallery','faculty'].map(app),[]);
    expect(items.map(item=>item.id)).toEqual(['faculty']);
  });
});
