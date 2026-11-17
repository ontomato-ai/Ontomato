import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({post:vi.fn(),get:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,backendGet:mocks.get,backendDelete:vi.fn(),backendPut:vi.fn(),buildBackendHeaders:(token:string,_user:unknown,_locale:unknown,apiKey:string)=>({...token?{tk:token}:{},...apiKey?{'X-API-Key':apiKey}:{}})}));
vi.mock('../../../config/data-query-api',()=>({getApiConfig:()=>({baseUrl:'http://ontology.test'})}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'host-service'})}}));
import {OntologyRetrievalClient} from '../ontology-retrieval';
const owner={userId:'U',domainId:'domain'},root='11111111-1111-4111-8111-111111111111',retrieval='22222222-2222-4222-8222-222222222222',run='33333333-3333-4333-8333-333333333333',key='44444444-4444-4444-8444-444444444444';
beforeEach(()=>{vi.resetAllMocks();mocks.post.mockResolvedValue({text:'{}'});mocks.get.mockResolvedValue({text:'{}'});});
it('the fixed submission client authenticates the executor and binds the initiators scope',async()=>{
 await new OntologyRetrievalClient(owner,root,{apiKey:'V-key'}).executeOperation({operation:'submit',retrievalId:retrieval,retrievalRunId:run,key,input:{question:'Question'}});
 expect(mocks.post).toHaveBeenCalledWith(expect.anything(),`http://ontology.test/ontology/retrievals/${retrieval}/runs/${run}/outputs`,{question:'Question'},expect.objectContaining({headers:expect.objectContaining({'X-API-Key':'V-key','X-Ontomato-Query-Service-Token':'host-service','X-Ontomato-Retrieval-Caller-Id':root,'X-Ontomato-Run-Id':run,'Idempotency-Key':key})}));
});
it('reading a submitted result keeps U and does not use the executor credential',async()=>{
 await new OntologyRetrievalClient(owner,root,{token:'U-token'}).executeOperation({operation:'content',retrievalId:retrieval,retrievalRunId:run,key});
 const headers=mocks.get.mock.calls[0][2].headers;
 expect(headers.tk).toBe('U-token');expect(headers).not.toHaveProperty('X-API-Key');
 expect(mocks.get.mock.calls[0][1]).toBe(`http://ontology.test/ontology/retrievals/${retrieval}/runs/${run}/outputs/${key}/content`);
});
