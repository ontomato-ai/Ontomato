import {beforeEach,expect,it,vi} from 'vitest';
import {HttpError} from '../../../utils/errors';
const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),dashboard:vi.fn()}));
vi.mock('../store',()=>({getProduct:mocks.get,saveProduct:mocks.save}));
vi.mock('../../dashboard/access',()=>({getOwnedDashboard:mocks.dashboard}));
import {migrateDashboardPage} from '../dashboard-migration';
const owner={domainId:'domain',userId:'author'};
beforeEach(()=>{vi.resetAllMocks();mocks.get.mockImplementation(async(_owner,id)=>{if(id==='board')return {id,editable:true,revision:2,name:'Board',description:'',document:{kind:'dashboard',dashboardId:'personal'}};throw new HttpError(404,'Missing');});});
it('preserves root identity, metric bindings and card width in a reference-only private Page',async()=>{
  mocks.dashboard.mockResolvedValue({groups:[{id:'group',title:'Overview',charts:[],metrics:[{id:'card',name:'Count',valueField:'count',unit:'people',layout:{colSpan:6},query:{kind:'metric',metricId:'count',parameters:{year:2026}}}]}]});
  await migrateDashboardPage(owner,{},'board',2);
  const [child,root]=mocks.save.mock.calls;
  expect(child[2].document).toMatchObject({kind:'metric-widget',renders:{id:'count'},parameters:{year:{source:'literal',value:2026}}});
  expect(root[1]).toBe('board');expect(root[2].document).toMatchObject({kind:'page',children:[{assetId:child[1],width:6}]});
  expect(root[2].document).not.toHaveProperty('widgets');
});
it('copies the new chart file without reconstructing its drawing',async()=>{
  const content={dataset:[{id:'metric',dimensions:['name','value'],source:[]}],series:[{id:'main',type:'pie',datasetId:'metric',encode:{itemName:'name',value:'value'}}],ontomato:{}};
  mocks.dashboard.mockResolvedValue({groups:[{id:'group',title:'Overview',charts:[{id:'chart',name:'Composition',chartFile:{name:'composition.chart.json',content},query:{kind:'metric',metricId:'composition',parameters:{}}}],metrics:[]}]});
  await migrateDashboardPage(owner,{},'board',2);
  expect(mocks.save.mock.calls[0][2].document).toMatchObject({kind:'metric-widget',renderer:'chart',chartFile:content,renders:{id:'composition'}});
  expect(mocks.save.mock.calls[0][2].document.valueField).toBe('');
});
it('does not silently discard presentation features during migration',async()=>{
  mocks.dashboard.mockResolvedValue({groups:[{id:'group',charts:[],metrics:[{id:'card',name:'Count',valueField:'count',query:{kind:'metric',metricId:'count',parameters:{}},formats:{count:{kind:'percent',scale:100}}}]}]});
  await expect(migrateDashboardPage(owner,{},'board',2)).rejects.toMatchObject({code:'PRODUCT_PRESENTATION_MIGRATION_REQUIRED'});
  expect(mocks.save).not.toHaveBeenCalled();
});
