import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),definition:vi.fn(),describe:vi.fn()}));
vi.mock('../store',()=>({getProduct:mocks.get}));
vi.mock('../definitions',()=>({readDefinition:mocks.definition}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
import {projectionSourceTypes} from '../invalidation';
it('derives invalidation classes from capability definitions and preserves an incomplete-metadata fallback',async()=>{
  mocks.get.mockResolvedValue({document:{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},renderer:'number',parameters:{},fields:[],valueField:'count',labelField:'',chartType:'bar',height:240}});
  mocks.describe.mockResolvedValue({sourceObjectTypes:['Person','Department']});
  await expect(projectionSourceTypes({domainId:'d',userId:'u'},'projection',{})).resolves.toEqual({objectTypes:['Person','Department'],complete:true});
  mocks.describe.mockResolvedValue({});
  await expect(projectionSourceTypes({domainId:'d',userId:'u'},'projection',{})).resolves.toMatchObject({complete:false});
});
