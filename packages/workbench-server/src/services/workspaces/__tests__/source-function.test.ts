import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({post:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service-only'})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
import {registerSourceFunction} from '../source-function';
it('derives immutable browser Function evidence from reviewed files and frozen governed contracts',async()=>{
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,functionId:'a'.repeat(64)})});
  const files=[{path:'index.html',encoding:'utf8' as const,content:'<script type="module" src="/apps-sdk/1.1.0/sdk.js"></script>'}];
  await expect(registerSourceFunction('domain','app-example','12345678-1234-1234-1234-123456789012',files,[{kind:'metric',id:'count',hash:'b'.repeat(64)}])).resolves.toBe('a'.repeat(64));
  const request=mocks.post.mock.calls[0][2];
  expect(request.artifact).toMatchObject({applicationId:'app-example',messageBridge:2,sdkVersions:['1.1.0'],dependencies:[{kind:'metric',id:'count',hash:'b'.repeat(64)}],files:[{path:'index.html',hash:expect.stringMatching(/^[a-f0-9]{64}$/)}]});
});
