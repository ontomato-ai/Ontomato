import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),get:vi.fn(),backendGet:vi.fn(),post:vi.fn()}));
const ontology=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../ontology',()=>({readProductOntology:ontology.read}));
vi.mock('../../../utils/backend-client',()=>({backendGet:mocks.backendGet,backendPost:mocks.post,buildBackendHeaders:()=>({})}));
vi.mock('../platform-objects',()=>({platformObjectTypes:()=>[]}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../store',()=>({getProduct:mocks.get}));
vi.mock('../grants',()=>({withProductGrants:async(_owner:unknown,action:()=>unknown)=>action(),currentProductGrants:()=>({use:new Set(['card']),edit:new Set()})}));
import {discoverProjections,validateDefaultProjections} from '../projections';
beforeEach(()=>{vi.resetAllMocks();ontology.read.mockResolvedValue({nodes:[{id:'card',revision:1}],edges:[{source:'card',relation:'renders',target_kind:'ObjectType',target_id:'Person',is_default:false}]});});
it('discovers caller-visible faces and warns when the element has no visible default',async()=>{
  mocks.query.mockResolvedValue({rows:[{asset_id:'card'}]});
  mocks.get.mockResolvedValue({id:'card',revision:1,document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},isDefault:false}});
  await expect(discoverProjections({domainId:'one',userId:'alice'},'ObjectType','Person')).resolves.toMatchObject({warnings:[{code:'DEFAULT_PROJECTION_MISSING'}]});
  mocks.get.mockResolvedValue({id:'card',revision:1,document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},isDefault:true}});
  await expect(discoverProjections({domainId:'one',userId:'alice'},'ObjectType','Person')).resolves.toMatchObject({warnings:[]});
});
it('checks all visible published elements while excluding drafts and honoring visible defaults',async()=>{
  mocks.backendGet.mockResolvedValue({text:JSON.stringify({classes:[{name:'Person'}]})});
  mocks.post.mockImplementation(async(_name:string,url:string)=>({text:JSON.stringify({success:true,data:url.includes('metricView')?[{id:'metric',name:'Count',status:'PUBLISHED'},{id:'draft',name:'Draft',status:'DRAFT'}]:[{id:'approve',name:'Approve',status:'PUBLISHED'}]})}));
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('business_definitions')?[{id:'members'}]:[{target_kind:'ObjectType',target_id:'Person'},{target_kind:'MetricView',target_id:'metric'}]}));
  ontology.read.mockResolvedValue({nodes:[],edges:[{source:'card',relation:'renders',target_kind:'ObjectType',target_id:'Person',is_default:true},{source:'metric-card',relation:'renders',target_kind:'MetricView',target_id:'metric',is_default:true}]});
  const result=await validateDefaultProjections({domainId:'one',userId:'alice'},{});
  expect(result.warnings.map(warning=>warning.id).sort()).toEqual(['approve','members']);
  expect(result.warnings.every(warning=>warning.severity==='warning')).toBe(true);
});
