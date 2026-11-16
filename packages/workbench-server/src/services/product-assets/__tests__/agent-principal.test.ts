import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({use:vi.fn(),post:vi.fn()}));
vi.mock('../grants',()=>({requireProductUse:mocks.use}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service-only'})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
import {agentPrincipalCredentials} from '../agent-principal';
beforeEach(()=>{vi.resetAllMocks();});
it('requires principal-use delegation before requesting independent execution credentials',async()=>{
  mocks.use.mockRejectedValue(Object.assign(new Error('Denied'),{status:403}));
  await expect(agentPrincipalCredentials('domain','agent','en','human')).rejects.toMatchObject({status:403});
  expect(mocks.post).not.toHaveBeenCalled();
  mocks.use.mockResolvedValue(undefined);mocks.post.mockResolvedValue({text:JSON.stringify({token:'ap1.signed.credential',expiresAt:Date.now()+60_000})});
  await expect(agentPrincipalCredentials('domain','agent','en','human')).resolves.toEqual({token:'ap1.signed.credential',locale:'en'});
  expect(mocks.use).toHaveBeenCalledWith({domainId:'domain',userId:'human'},'agent');
  expect(mocks.post.mock.calls[0][2]).toMatchObject({domainId:'domain',principalId:'agent'});
});
