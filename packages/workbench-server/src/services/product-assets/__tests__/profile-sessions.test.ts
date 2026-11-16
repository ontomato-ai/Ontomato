import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),lock:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(fn:(client:{query:typeof mocks.query})=>unknown)=>fn({query:mocks.query})}));
vi.mock('../../agent-host/session-claim',()=>({lockSessionClaim:mocks.lock}));
import {bindProfileSession} from '../profile-sessions';
beforeEach(()=>{vi.resetAllMocks();});
it('rejects binding another owners conversation before writing a Profile association',async()=>{
  mocks.query.mockResolvedValue({rows:[]});
  await expect(bindProfileSession({domainId:'domain',userId:'reader'},'session','profile','release')).rejects.toMatchObject({status:404});
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
});
it('rejects an idempotent session reused with a different Profile release',async()=>{
  mocks.query.mockResolvedValueOnce({rows:[{id:'session'}]}).mockResolvedValueOnce({rows:[]});
  await expect(bindProfileSession({domainId:'domain',userId:'reader'},'session','profile','other-release')).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
