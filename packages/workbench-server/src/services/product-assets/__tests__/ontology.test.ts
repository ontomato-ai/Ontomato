import {beforeEach,expect,it,vi} from 'vitest';
const grants=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../../product-governance/grants',()=>({readProductGrantRecords:grants.read}));
import {addAuthorizationEdges} from '../ontology';
beforeEach(()=>{vi.resetAllMocks();});
it('uses catalogue grant eligibility and isolates authorization read failures by application',async()=>{
  const nodes=['denied','managed','visible'].map(assetId=>({
    id:`asset:${assetId}`,assetId,name:assetId,kind:'application',category:'bundle' as const,
  }));
  grants.read.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({grants:[
    {principalKind:'role',principalId:'reader',principalName:'业务查看者',verb:'use'},
  ]});
  const graph=await addAuthorizationEdges(
    {graph:{nodes,edges:[]},grantableApplicationIds:new Set(['denied','managed'])},
    {domainId:'domain',userId:'human'},{token:'caller'},
  );
  expect(grants.read.mock.calls.map(([id])=>id)).toEqual(['denied','managed']);
  expect(graph.edges).toContainEqual({source:'grant:role:reader',target:'asset:managed',relation:'use',storage:'governance'});
  expect(graph.nodes).toContainEqual({id:'grant:role:reader',name:'业务查看者',kind:'role',category:'principal'});
});
