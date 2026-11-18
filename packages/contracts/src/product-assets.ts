import { z } from "zod";
import { personalWorkspaceSchema } from "./personal-workspace";
import { viewWidgetSchema, nonChartViewWidgetSchema, type ViewWidget } from "./object-views";
import {metricProjectionSchema,actionProjectionSchema,collectionProjectionSchema,objectProjectionSchema,navigationSchema,agentProfileSchema,ontologyParameterTypeSchema} from './product-projections';

const id = z.string().min(1).max(200);
const title = z.string().trim().min(1).max(200);
// Product widgets bind interfaces and interaction state; object reads and business predicates belong to capabilities.
export const productWidgetSchema = nonChartViewWidgetSchema.strict().superRefine((widget, ctx) => {
  if (!["text", "metric", "table", "input", "action", "button"].includes(widget.kind))
    ctx.addIssue({ code: "custom", message: "Use a published MetricView to read business data" });
  if (["metric", "table", "action"].includes(widget.kind) && !widget.resourceId)
    ctx.addIssue({ code: "custom", message: "A published capability ID is required" });
  if (widget.visibleWhen || widget.binding?.source === "object" || widget.binding?.source === "context" || Object.values(widget.parameters).some(binding => binding.source === "object" || binding.source === "context"))
    ctx.addIssue({ code: "custom", message: "Product widgets use capability parameters and local interaction variables, not business predicates" });
  if(widget.kind === "metric" && !widget.valueField)
    ctx.addIssue({code:"custom",message:"Metric value field is required"});
  if(widget.resultPath || widget.resultIndex)
    ctx.addIssue({code:"custom",message:"Leave resultPath empty: MetricViews return a row array"});
  if(widget.binding && ['metric','table','action'].includes(widget.kind))
    ctx.addIssue({code:'custom',message:'Capability widgets cannot replace results with a local binding'});
  if(widget.targetClass||widget.onClick==='openObject'||widget.relation||widget.contextFields.length)
    ctx.addIssue({code:'custom',message:'Use an object-view asset for business object navigation'});
  if(widget.binding?.source === "literal" && widget.kind !== "text" && widget.kind !== "button")
    ctx.addIssue({code:"custom",message:"Business results must come from the referenced capability"});
});
const placement = z.object({ assetId: id, column: z.enum(["main", "sidebar"]).default("main"), span:z.enum(['full','half']).optional(),width:z.number().int().min(1).max(12).optional() }).strict();
const placements = z.array(placement).max(50).refine(items => new Set(items.map(item => item.assetId)).size === items.length, "Duplicate asset placement");
const widgetsSchema=z.array(productWidgetSchema).min(1).max(20).refine(widgets=>new Set(widgets.map(widget=>widget.id)).size===widgets.length,"Duplicate widget ID");
export const productPageLayoutSchema=z.object({mode:z.enum(['columns','grid']).default('columns'),mainWidth:z.number().int().min(4).max(12).default(8),gap:z.enum(['compact','normal','comfortable']).default('normal')}).strict();
const pageDocumentSchema=z.object({kind:z.literal('page'),children:placements,layout:productPageLayoutSchema.optional(),params:z.record(ontologyParameterTypeSchema).optional(),compositionVersion:z.literal(2).optional(),embeddable:z.boolean().optional(),isTemplate:z.boolean().optional()}).strict();
const applicationDocumentSchema=z.object({kind:z.literal('application'),applicationId:id,workspaceId:z.string().uuid().optional(),children:placements,navigationId:id.optional()}).strict();
export const platformWidgetSchema=z.object({kind:z.literal('platform'),source:z.enum(['assistant','apps','data','tasks','conversations','objects','recent']),placeholder:z.string().max(500).default(''),limit:z.number().int().min(1).max(20).default(4),workspace:personalWorkspaceSchema.optional()}).strict();
export const productPlatformRuntimeKey=Symbol.for('ontomato.product-platform-runtime');
export const productAgentRuntimeKey=Symbol.for('ontomato.product-agent-runtime');
export const productDocumentSchema = z.discriminatedUnion("kind", [
  metricProjectionSchema,actionProjectionSchema,collectionProjectionSchema,objectProjectionSchema,
  navigationSchema.innerType(),agentProfileSchema,
  pageDocumentSchema.extend({workspace:personalWorkspaceSchema.optional()}),
  z.object({ kind: z.literal("layout-template"), workspace: personalWorkspaceSchema, children: placements,compositionVersion:z.literal(2).optional() }).strict(),
  z.object({ kind: z.literal("widget"), widget: z.union([productWidgetSchema,platformWidgetSchema]) }).strict(),
  z.object({ kind: z.literal("operation-panel"), widgets: widgetsSchema.refine(widgets=>widgets.some(widget=>widget.kind==='action'),'An operation panel requires an Action entry') }).strict(),
  z.object({ kind: z.literal("widget-group"), widgets: widgetsSchema.refine(widgets=>widgets.every(widget=>['text','metric','table'].includes(widget.kind)),'Display groups only contain presentation widgets') }).strict(),
  z.object({ kind: z.literal("dashboard"), dashboardId: id }).strict(),
  z.object({ kind: z.literal("object-view"), className: id, primaryKey: z.string().min(1).max(1000).optional(), form: z.literal("full").default("full") }).strict(),
  applicationDocumentSchema,
]);
export type ProductDocument = z.infer<typeof productDocumentSchema>;
function refineMetricPresentation(document: ProductDocument, context: z.RefinementCtx) {
  if (document.kind !== "metric-widget") return;
  const issue = (field: string, message: string) => context.addIssue({ code: "custom", path: [field], message });
  if (document.renderer === "chart") {
    if (!document.chartFile) issue("chartFile", "A chart renderer requires a chart file");
    if (document.fields.length) issue("fields", "Chart fields belong in the chart file");
    if (document.valueField) issue("valueField", "Chart value mappings belong in the chart file");
    if (document.labelField) issue("labelField", "Chart label mappings belong in the chart file");
    if (document.chartType !== "bar") issue("chartType", "Chart types belong in the chart file");
    if (document.format !== undefined) issue("format", "Chart formats belong in the chart file");
    if (document.display !== undefined) issue("display", "Chart display settings belong in the chart file");
  } else if (document.chartFile !== undefined) issue("chartFile", "Only chart renderers use a chart file");
}
export const productAssetInputSchema = z.object({
  name: title, description: z.string().max(2000).default(""),
  visibility: z.enum(["private", "domain"]).default("private"),
  document: productDocumentSchema.superRefine(refineMetricPresentation),
}).strict().superRefine((asset,context)=>{
  if(asset.document.kind==='navigation'){
    const result=navigationSchema.safeParse(asset.document);
    if(!result.success)context.addIssue({code:'custom',message:'Navigation requires distinct nodes and a valid entry'});
  }
  const widgets=productWidgets(asset.document);
  const variables=new Set(widgets.flatMap(widget=>widget.kind!=='chart'&&['input','table','button'].includes(widget.kind)&&widget.variable?[widget.variable]:[]));
  for(const widget of widgets){
    const bindings=[...Object.values(widget.parameters),...(widget.kind!=='chart'&&widget.binding?[widget.binding]:[])];
    for(const binding of bindings){
      if(binding.source==='variable'&&!['metric-widget','action-view'].includes(asset.document.kind)&&!variables.has(binding.path.split('.')[0]))context.addIssue({code:'custom',message:`Interaction variable has no source: ${binding.path}`});
    }
  }
});
export const productAssetSchema = productAssetInputSchema.innerType().extend({
  id, ownerId: id, revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
  editable: z.boolean(),
  sourceObjectTypes:z.array(id).optional(),
}).strict();
export type ProductAssetInput = z.infer<typeof productAssetInputSchema>;
export type ProductAsset = z.infer<typeof productAssetSchema>;
export const productSaveSchema = productAssetInputSchema.innerType().extend({ revision: z.number().int().nonnegative() }).strict();
export const productAuthoringDocumentSchema=z.discriminatedUnion("kind",[
  metricProjectionSchema.extend({renderer:z.enum(['number','chart']).default('number')}),actionProjectionSchema,collectionProjectionSchema,objectProjectionSchema,navigationSchema.innerType(),agentProfileSchema,
  pageDocumentSchema,applicationDocumentSchema,
]);
export const productAuthoringSchema=productSaveSchema.omit({visibility:true}).extend({document:productAuthoringDocumentSchema.superRefine(refineMetricPresentation)});
export const productReferenceSchema = z.object({
  kind: z.enum(["asset", "metric", "action", "dashboard", "application", "object-view",'definition','object-type']), id,
}).strict();
export type ProductReference = z.infer<typeof productReferenceSchema>;
export const productManifestSchema=z.object({schemaVersion:z.literal(1),assetIds:z.array(id).max(50).refine(ids=>new Set(ids).size===ids.length,"Duplicate product asset reference"),triggerIds:z.array(id).max(50).refine(ids=>new Set(ids).size===ids.length,'Duplicate Trigger dependency').optional()}).strict();

/** Derived from the persisted definition, never supplied as an independent dependency list. */
export function productReferences(document: ProductDocument): ProductReference[] {
  const references: ProductReference[] = [];
  if(document.kind==='metric-widget')references.push({kind:'metric',id:document.renders.id});
  if(document.kind==='action-view')references.push({kind:'action',id:document.renders.id});
  if(document.kind==='collection-view')references.push({kind:'definition',id:document.renders.id});
  if(document.kind==='object-projection')references.push({kind:'object-type',id:document.renders.id});
  if(document.kind==='object-projection'&&document.layout)for(const widget of document.layout.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
    if(widget.resourceId&&widget.kind==='action')references.push({kind:'action',id:widget.resourceId});
    else if(widget.resourceId&&['properties','links','metric','table','chart'].includes(widget.kind))references.push({kind:'metric',id:widget.resourceId});
  }
  if(document.kind==='navigation')references.push(...document.nodes.map(node=>({kind:'asset' as const,id:node.pageId})));
  if(document.kind==='agent-profile')references.push(...[...document.tools,...document.contextViews].map(id=>({kind:'asset' as const,id})));
  if ("children" in document) references.push(...document.children.map(child => ({ kind: "asset" as const, id: child.assetId })));
  if (document.kind === "layout-template") {
    references.push(...document.workspace.dashboardIds.map(id => ({ kind: "dashboard" as const, id })));
    references.push(...document.workspace.applicationIds.map(id => ({ kind: "application" as const, id })));
  }
  if (document.kind === "dashboard") references.push({ kind: "dashboard", id: document.dashboardId });
  if (document.kind === "object-view") references.push({kind:"object-view",id:document.className});
  if (document.kind === "application") references.push({ kind: "application", id: document.applicationId });
  if(document.kind==='application'&&document.navigationId)references.push({kind:'asset',id:document.navigationId});
  const platform=platformWidget(document);
  if(platform?.workspace){
    if(platform.source==='apps')references.push(...platform.workspace.applicationIds.map(id=>({kind:'application' as const,id})));
    if(platform.source==='data')references.push(...platform.workspace.dashboardIds.map(id=>({kind:'dashboard' as const,id})));
  }
  const widgets = productWidgets(document);
  for (const widget of widgets) {
    if (["metric", "chart", "table"].includes(widget.kind)) references.push({ kind: "metric", id: widget.resourceId });
    if (widget.kind === "action") references.push({ kind: "action", id: widget.resourceId });
  }
  return [...new Map(references.map(reference => [`${reference.kind}:${reference.id}`, reference])).values()];
}
export function productWidgets(document:ProductDocument):ViewWidget[]{
  if(document.kind==='metric-widget'){
    if(document.renderer==='chart')return [{id:'projection',kind:'chart',title:'',span:12,resourceId:document.renders.id,chartFile:document.chartFile!,parameters:document.parameters,height:document.height}];
    return [viewWidgetSchema.parse({id:'projection',...document.presentation,kind:document.renderer==='number'?'metric':'table',title:'',span:12,resourceId:document.renders.id,parameters:document.parameters,fields:document.fields,valueField:document.valueField,labelField:document.labelField,chartType:document.chartType,height:document.height})];
  }
  if(document.kind==='action-view')return [viewWidgetSchema.parse({id:'projection',...document.presentation,kind:'action',title:'',span:12,resourceId:document.renders.id,parameters:document.parameters,readOnlyParameters:document.readOnlyParameters})];
  return document.kind==='widget'&&document.widget.kind!=='platform'?[document.widget]:document.kind==='operation-panel'||document.kind==='widget-group'?document.widgets:[];
}
export function platformWidget(document:ProductDocument){return document.kind==='widget'&&document.widget.kind==='platform'?document.widget:undefined;}

export const productTypes = [
  {kind:'application',category:'bundle',name:'应用',description:'面向人的产品交付，装配导航与页面并固定发布依赖'},
  {kind:'agent-profile',category:'bundle',name:'智能体配置',description:'面向智能体的能力交付，引用工具投影、对象上下文和指令'},
  {kind:'page',category:'composition',name:'页面',description:'以资产引用组织布局；模板和可嵌入页面是页面形态'},
  {kind:'navigation',category:'composition',name:'导航',description:'引用页面，组织入口、菜单、深链接与转场'},
  {kind:'object-projection',category:'element',name:'对象视图',description:'绑定一个对象类型，呈现对象属性、关系与上下文'},
  {kind:'collection-view',category:'element',name:'集合视图',description:'绑定一个已发布业务定义，呈现其成员集合'},
  {kind:'metric-widget',category:'element',name:'指标组件',description:'绑定一个已发布指标，呈现数值、趋势或图表'},
  {kind:'action-view',category:'element',name:'动作视图',description:'绑定一个已发布动作，呈现参数表单与执行入口'},
] as const;

export const productQuerySchema=z.object({
  search:z.string().trim().max(200).default(''),
  kind:z.enum(['page','layout-template','widget','widget-group','operation-panel','dashboard','object-view','application','metric-widget','action-view','collection-view','object-projection','navigation','agent-profile']).optional(),
  scope:z.enum(['all','mine','shared']).default('all'),
  pageForm:z.enum(['all','page','embeddable','template']).optional(),
   sort:z.enum(['structure','updated','name']).optional(),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ProductQuery=z.infer<typeof productQuerySchema>;
export const productCountsResponseSchema=z.object({counts:z.record(z.number().int().nonnegative())});
export const productSummarySchema=productAssetSchema.omit({document:true}).extend({kind:productQuerySchema.shape.kind.unwrap(),details:z.object({isTemplate:z.boolean().optional(),embeddable:z.boolean().optional(),renderer:z.string().optional(),widgetKind:z.string().optional(),chartType:z.string().optional(),section:z.string().optional(),className:z.string().optional(),resourceId:z.string().optional(),childCount:z.number().int().nonnegative().optional(),widgetCount:z.number().int().nonnegative().optional(),widgetKinds:z.array(z.string()).optional()}).default({})});
export type ProductSummary=z.infer<typeof productSummarySchema>;
export const productPageSchema=z.object({items:z.array(productSummarySchema),total:z.number().int().nonnegative(),page:z.number(),pageSize:z.number()});
/** Chinese defaults the server writes into generated assets and graph names; displays translate a value only while it still equals one of these. */
export const productDefaultTexts={
  homeName:'我的工作台',
  homeDescription:'常用入口与正在进行的工作',
  initialHomeName:'我的主页',
  apps:'常用应用',
  data:'关注的数据',
  tasks:'任务动态',
  conversations:'继续工作',
  objects:'我的收藏',
  recent:'最近访问',
  legacyAssistant:'你想了解哪些数据？',
  legacyAssistantDescription:'用日常语言提问，让智能体帮你查询和分析',
  legacyAssistantPlaceholder:'例如：按学院统计在职教职工人数，并比较人员构成',
  legacyConversations:'继续分析',
  legacyObjects:'收藏的对象',
  platformPageDescription:'平台应用的产品组合根；原生交互仍由已注册入口运行。',
  graphDomainMembers:'域内成员',
  graphNameUnavailable:'名称暂不可用',
  graphAgentDefinition:'引用的智能体',
  graphRoleUnavailable:'角色名称暂不可用',
  graphPrincipalUnavailable:'主体名称暂不可用',
  graphMetricUnavailable:'指标视图名称暂不可用',
  graphActionUnavailable:'动作名称暂不可用',
  graphDefinitionUnavailable:'业务定义名称暂不可用',
  graphObjectTypeUnavailable:'对象类型名称暂不可用',
  graphApplicationUnavailable:'应用名称暂不可用',
} as const;
