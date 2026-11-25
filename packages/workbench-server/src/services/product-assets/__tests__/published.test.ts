import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({use:vi.fn(),get:vi.fn(),active:vi.fn(),release:vi.fn(),backend:vi.fn(),synchronize:vi.fn()}));
vi.mock('../grants',()=>({requireProductUse:mocks.use}));
vi.mock('../store',()=>({getApplicationProduct:mocks.get}));
vi.mock('../releases',()=>({readActiveProductBundle:mocks.active,readProductRelease:mocks.release,synchronizeBundlePublication:mocks.synchronize}));
vi.mock('../../../utils/backend-client',()=>({backendGet:mocks.backend,buildBackendHeaders:()=>({})}));
import {HttpError} from "../../../utils/errors";
import {publishedApplication} from '../published';
const owner={domainId:'domain',userId:'reader'};
beforeEach(()=>{vi.resetAllMocks();});
it('checks the imported asset grant but reads the release using the catalog application identity',async()=>{
 mocks.get.mockResolvedValue({id:'imported',document:{kind:'application',applicationId:'app'}});
 mocks.backend.mockImplementation(async(name:string)=>({text:JSON.stringify(name==='published-application-admission'?{success:true,data:[{id:'app'}]}:{success:true,data:{releaseId:'release'}})}));
 mocks.release.mockResolvedValue({roots:[],assets:[]});
 await publishedApplication(owner,{},'app');
 expect(mocks.use).toHaveBeenCalledWith(owner,'imported');
 expect(mocks.release).toHaveBeenCalledWith(owner,'release','app');
});
it('resolves declarative applications from their active frozen bundle without a source catalog lookup',async()=>{
  mocks.get.mockResolvedValue({document:{kind:'application',navigationId:'nav'}});mocks.active.mockResolvedValue({snapshot:{roots:['app'],assets:[]}});
  await expect(publishedApplication(owner,{},'app')).resolves.toEqual({roots:['app'],assets:[]});
  expect(mocks.backend).not.toHaveBeenCalled();
});
it('rejects a hosted application absent from the current readable entry catalog before reading its release',async()=>{
  mocks.get.mockResolvedValue({document:{kind:'application',workspaceId:'workspace'}});mocks.backend.mockResolvedValue({text:JSON.stringify({success:true,data:[]})});
  await expect(publishedApplication(owner,{},'app')).rejects.toMatchObject({code:'PRODUCT_FORBIDDEN'});
  expect(mocks.release).not.toHaveBeenCalled();
});
it('reports a pending declaration to its editor without publishing during reads',async()=>{
  mocks.get.mockResolvedValue({id:'app',editable:true,document:{kind:'application',navigationId:'nav'}});
  mocks.active.mockRejectedValueOnce(new HttpError(409, 'Publication pending', 'PRODUCT_PUBLICATION_PENDING'));
  await expect(publishedApplication(owner,{token:'editor'},'app')).rejects.toMatchObject({code:'PRODUCT_PUBLICATION_PENDING'});
  expect(mocks.synchronize).not.toHaveBeenCalled();
  mocks.active.mockResolvedValue({snapshot:{roots:['app'],assets:[]}});
  await expect(publishedApplication(owner,{token:'editor'},'app')).resolves.toEqual({roots:['app'],assets:[]});
  expect(mocks.synchronize).not.toHaveBeenCalled();
});
