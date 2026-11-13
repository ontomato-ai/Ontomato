import { z } from "zod";
import { personalWorkspaceSchema } from "./personal-workspace";
import { viewWidgetSchema } from "./object-views";

const id = z.string().min(1).max(200);
const title = z.string().trim().min(1).max(200);
// Product widgets bind interfaces and interaction state; object reads and business predicates belong to capabilities.
export const productWidgetSchema = viewWidgetSchema.strict().superRefine((widget, ctx) => {
  if (!["text", "metric", "table", "chart", "input", "action", "button"].includes(widget.kind))
    ctx.addIssue({ code: "custom", message: "Use a published MetricView to read business data" });
  if (["metric", "table", "chart", "action"].includes(widget.kind) && !widget.resourceId)
    ctx.addIssue({ code: "custom", message: "A published capability ID is required" });
  if (widget.visibleWhen || widget.binding?.source === "object" || widget.binding?.source === "context" || Object.values(widget.parameters).some(binding => binding.source === "object" || binding.source === "context"))
    ctx.addIssue({ code: "custom", message: "Product widgets use capability parameters and local interaction variables, not business predicates" });
  if(widget.kind === "chart" && (!widget.valueField || !widget.labelField))
    ctx.addIssue({code:"custom",message:"Chart value and label fields are required"});
  if(widget.kind === "metric" && !widget.valueField)
    ctx.addIssue({code:"custom",message:"Metric value field is required"});
  if(widget.resultPath || widget.resultIndex)
    ctx.addIssue({code:"custom",message:"Leave resultPath empty: MetricViews return a row array"});
  if(widget.binding && ['metric','table','chart','action'].includes(widget.kind))
    ctx.addIssue({code:'custom',message:'Capability widgets cannot replace results with a local binding'});
  if(widget.targetClass||widget.onClick==='openObject'||widget.relation||widget.contextFields.length)
    ctx.addIssue({code:'custom',message:'Use an object-view asset for business object navigation'});
  if(widget.skillId!=='echarts'&&widget.kind==='chart')
    ctx.addIssue({code:'custom',message:'Product charts use the registered ECharts renderer'});
  if(widget.kind==='chart'&&!['bar','line','donut'].includes(widget.chartType))
    ctx.addIssue({code:'custom',message:'This product chart supports bar, line or donut; use the existing object view for other visualizations'});
  if(widget.binding?.source === "literal" && widget.kind !== "text" && widget.kind !== "button")
    ctx.addIssue({code:"custom",message:"Business results must come from the referenced capability"});
});
const placement = z.object({ assetId: id, column: z.enum(["main", "sidebar"]).default("main"), span:z.enum(['full','half']).optional() }).strict();
const placements = z.array(placement).max(50).refine(items => new Set(items.map(item => item.assetId)).size === items.length, "Duplicate asset placement");
const widgetsSchema=z.array(productWidgetSchema).min(1).max(20).refine(widgets=>new Set(widgets.map(widget=>widget.id)).size===widgets.length,"Duplicate widget ID");
export const platformWidgetSchema=z.object({kind:z.literal('platform'),source:z.enum(['assistant','apps','data','tasks','conversations','objects','recent']),placeholder:z.string().max(500).default(''),limit:z.number().int().min(1).max(20).default(4),workspace:personalWorkspaceSchema.optional()}).strict();
export const productPlatformRuntimeKey=Symbol.for('ontomato.product-platform-runtime');
export const productDocumentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), workspace: personalWorkspaceSchema, children: placements,compositionVersion:z.literal(2).optional() }).strict(),
  z.object({ kind: z.literal("layout-template"), workspace: personalWorkspaceSchema, children: placements,compositionVersion:z.literal(2).optional() }).strict(),
  z.object({ kind: z.literal("widget"), widget: z.union([productWidgetSchema,platformWidgetSchema]) }).strict(),
  z.object({ kind: z.literal("operation-panel"), widgets: widgetsSchema.refine(widgets=>widgets.some(widget=>widget.kind==='action'),'An operation panel requires an Action entry') }).strict(),
  z.object({ kind: z.literal("widget-group"), widgets: widgetsSchema.refine(widgets=>widgets.every(widget=>['text','metric','table','chart'].includes(widget.kind)),'Display groups only contain presentation widgets') }).strict(),
  z.object({ kind: z.literal("dashboard"), dashboardId: id }).strict(),
  z.object({ kind: z.literal("object-view"), className: id, primaryKey: z.string().min(1).max(1000).optional(), form: z.literal("full").default("full") }).strict(),
  z.object({ kind: z.literal("application"), applicationId: id, workspaceId: z.string().uuid().optional(), children: placements }).strict(),
]);
export type ProductDocument = z.infer<typeof productDocumentSchema>;
export const productAssetInputSchema = z.object({
  name: title, description: z.string().max(2000).default(""),
  visibility: z.enum(["private", "domain"]).default("private"),
  document: productDocumentSchema,
}).strict().superRefine((asset,context)=>{
  const widgets=productWidgets(asset.document);
  const variables=new Set(widgets.filter(widget=>['input','table','button'].includes(widget.kind)&&widget.variable).map(widget=>widget.variable));
  for(const widget of widgets){
    const bindings=[...Object.values(widget.parameters),...(widget.binding?[widget.binding]:[])];
    for(const binding of bindings){
      if(binding.source==='variable'&&!variables.has(binding.path.split('.')[0]))context.addIssue({code:'custom',message:`Interaction variable has no source: ${binding.path}`});
    }
  }
});
export const productAssetSchema = productAssetInputSchema.innerType().extend({
  id, ownerId: id, revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
  editable: z.boolean(),
}).strict();
export type ProductAssetInput = z.infer<typeof productAssetInputSchema>;
export type ProductAsset = z.infer<typeof productAssetSchema>;
export const productSaveSchema = productAssetInputSchema.innerType().extend({ revision: z.number().int().nonnegative() }).strict();
export const productReferenceSchema = z.object({
  kind: z.enum(["asset", "metric", "action", "dashboard", "application", "object-view"]), id,
}).strict();
export type ProductReference = z.infer<typeof productReferenceSchema>;
export const productManifestSchema=z.object({schemaVersion:z.literal(1),assetIds:z.array(id).max(50).refine(ids=>new Set(ids).size===ids.length,"Duplicate product asset reference")}).strict();

/** Derived from the persisted definition, never supplied as an independent dependency list. */
export function productReferences(document: ProductDocument): ProductReference[] {
  const references: ProductReference[] = [];
  if ("children" in document) references.push(...document.children.map(child => ({ kind: "asset" as const, id: child.assetId })));
  if (document.kind === "page" || document.kind === "layout-template") {
    references.push(...document.workspace.dashboardIds.map(id => ({ kind: "dashboard" as const, id })));
    references.push(...document.workspace.applicationIds.map(id => ({ kind: "application" as const, id })));
  }
  if (document.kind === "dashboard") references.push({ kind: "dashboard", id: document.dashboardId });
  if (document.kind === "object-view") references.push({kind:"object-view",id:document.className});
  if (document.kind === "application") references.push({ kind: "application", id: document.applicationId });
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
export function productWidgets(document:ProductDocument){return document.kind==='widget'&&document.widget.kind!=='platform'?[document.widget]:document.kind==='operation-panel'||document.kind==='widget-group'?document.widgets:[];}
export function platformWidget(document:ProductDocument){return document.kind==='widget'&&document.widget.kind==='platform'?document.widget:undefined;}

export const productTypes = [
  { kind: "application", name: "应用", description: "关联平台应用入口与产品资产" },
  { kind: "page", name: "页面", description: "工作台区块、组件引用与布局" },
  { kind: "layout-template", name: "布局模板", description: "复制后形成独立的个人页面" },
  { kind: "dashboard", name: "仪表盘", description: "引用现有仪表盘，复用其指标与展示" },
  { kind: "object-view", name: "对象视图", description: "复用对象类的已发布视图，可绑定具体对象" },
  { kind: "operation-panel", name: "操作板", description: "操作入口、参数输入与执行后刷新" },
  { kind: "widget-group", name: "组件组", description: "组合指标、图表和说明，不包含业务操作" },
  { kind: "widget", name: "组件", description: "展示已发布指标或调用已发布操作" },
] as const;

export const productQuerySchema=z.object({
  search:z.string().trim().max(200).default(''),
  kind:z.enum(['page','layout-template','widget','widget-group','operation-panel','dashboard','object-view','application']).optional(),
  scope:z.enum(['all','mine','shared']).default('all'),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ProductQuery=z.infer<typeof productQuerySchema>;
export const productCountsResponseSchema=z.object({counts:z.record(z.number().int().nonnegative())});
export const productSummarySchema=productAssetSchema.omit({document:true}).extend({kind:productQuerySchema.shape.kind.unwrap(),details:z.object({widgetKind:z.string().optional(),chartType:z.string().optional(),section:z.string().optional(),className:z.string().optional(),resourceId:z.string().optional(),childCount:z.number().int().nonnegative().optional(),widgetCount:z.number().int().nonnegative().optional(),widgetKinds:z.array(z.string()).optional()}).default({})});
export type ProductSummary=z.infer<typeof productSummarySchema>;
export const productPageSchema=z.object({items:z.array(productSummarySchema),total:z.number().int().nonnegative(),page:z.number(),pageSize:z.number()});
