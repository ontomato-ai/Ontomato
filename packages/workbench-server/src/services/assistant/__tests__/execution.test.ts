import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),turn:vi.fn(),run:vi.fn()}));
vi.mock('../execution-setting',()=>({resolveAgentExecution:mocks.resolve}));
vi.mock('../store',()=>({assistantStore:{turn:mocks.turn}}));
vi.mock('../../../infrastructure/agent-runtime/client',()=>({RuntimeClient:class {run=mocks.run;}}));
import {agentExecutionCredentials,credentialsForRun} from '../execution';
const owner={domainId:'domain',userId:'U'},original={token:'original',locale:'en'};
beforeEach(()=>{vi.resetAllMocks();});
it('self mode keeps the original credential and never requires a shared key',async()=>{
 expect(await agentExecutionCredentials('agent',null,owner,original)).toEqual({...original,executionUserId:null});
 expect(mocks.resolve).not.toHaveBeenCalled();
});
it('explicitly selecting U still validates its current shared key on every protected call',async()=>{
 mocks.resolve.mockResolvedValueOnce({credentials:{apiKey:'first',locale:'en'}}).mockResolvedValueOnce({credentials:{apiKey:'renewed',locale:'en'}});
 expect((await agentExecutionCredentials('agent','U',owner,original)).apiKey).toBe('first');
 expect((await agentExecutionCredentials('agent','U',owner,original)).apiKey).toBe('renewed');
 expect(mocks.resolve).toHaveBeenNthCalledWith(2,{id:'agent',execution_user_id:'U'},owner,original);
});
it('restores the fixed run selection without rereading the current definition',async()=>{
 mocks.run.mockResolvedValue({run:{id:'run',status:'running',executionUserId:'fixed',channel:{agent:{agentId:'agent'}}}});
 mocks.resolve.mockResolvedValue({credentials:{apiKey:'fixed-key',locale:'en'}});
 const restored=await credentialsForRun(owner,'run',original);
 expect(restored.executionUserId).toBe('fixed');expect(restored.credentials.apiKey).toBe('fixed-key');
 expect(mocks.turn).toHaveBeenCalledWith('run',owner);
 expect(mocks.resolve).toHaveBeenCalledWith({id:'agent',execution_user_id:'fixed'},owner,original);
 expect(restored.credentials.headers).toMatchObject({'X-API-Key':'fixed-key','X-Ontomato-Retrieval-Caller-Id':'run'});
});
it('does not fall back to the initiator when the fixed executor becomes invalid',async()=>{
 mocks.resolve.mockRejectedValue(new Error('invalid shared key'));
 await expect(agentExecutionCredentials('agent','V',owner,original)).rejects.toThrow('invalid shared key');
});

it('rejects a callback for another session before restoring a selected users key',async()=>{
 mocks.run.mockResolvedValue({run:{id:'run',sessionId:'owned-session',status:'running',executionUserId:'fixed',channel:{agent:{agentId:'agent'}}}});
 await expect(credentialsForRun(owner,'run',original,'another-session')).rejects.toMatchObject({status:403,code:'PROFILE_CONTEXT_REQUIRED'});
 expect(mocks.resolve).not.toHaveBeenCalled();
});
