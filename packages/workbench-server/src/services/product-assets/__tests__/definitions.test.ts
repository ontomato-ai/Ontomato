import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),post:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:mocks.query})}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({tk:'caller'})}));
import {executeDefinition} from '../../business-definitions/definitions';
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue({rows:[{definition:{id:'members',name:'Members',objectType:'Person',revision:1,status:'PUBLISHED',parameters:[]}}]});});
it('uses the governed schema primary key for stable collection pagination',async()=>{
  mocks.post.mockResolvedValueOnce({text:JSON.stringify({classes:[{className:'Person',attrs:[{name:'personKey',primaryKey:true},{name:'name'}]}]})}).mockResolvedValueOnce({text:JSON.stringify({data:[{answer:[{name:'Alice'}]}]})});
  await expect(executeDefinition({domainId:'d',userId:'u'},{token:'caller'},'members',{},['name'],50)).resolves.toMatchObject({rows:[{name:'Alice'}]});
  expect(mocks.post.mock.calls[1][2].dsl.answer.steps[0].output).toMatchObject({sort:{fields:[{field:'personKey'}]},limit:{count:50,offset:50}});
});
it('rejects unavailable fields before issuing a data query',async()=>{
  mocks.post.mockResolvedValue({text:JSON.stringify({classes:[{className:'Person',attrs:[{name:'personKey',primaryKey:true}]}]})});
  await expect(executeDefinition({domainId:'d',userId:'u'},{},'members',{},['salary'],0)).rejects.toMatchObject({code:'INVALID_PRODUCT_FIELD'});
  expect(mocks.post).toHaveBeenCalledTimes(1);
});
