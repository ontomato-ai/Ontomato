import { validateStoredChartFile } from "@ontomato/contracts/chart-data";
import type { DashboardMetricDescription } from "@ontomato/contracts/dashboard";
import type { ViewWidget } from "@ontomato/contracts/object-views";
import { productReferences, productWidgets,platformWidget, type ProductAssetInput,type ProductAsset } from "@ontomato/contracts/product-assets";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { DashboardMetricClient } from "../dashboard/metric-client";
import { getOwnedDashboard } from "../dashboard/access";
import { config } from "../../config/application";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "./store";
import { objectViewDocumentSchema, objectViewProductIssues,objectProjectionIssues } from "@ontomato/contracts/object-views";
import {readDefinition} from './definitions';
import {platformObjectProvider} from './platform-objects';
import {pageBindingType} from '@ontomato/contracts/product-page-state';

/** Product storage owns empty snapshots; chart-data owns the format and output references. */
function validateMetricFields(widget: ViewWidget, metric: Pick<DashboardMetricDescription, "outputColumns">) {
  if (widget.kind === "chart") {
    const result = validateStoredChartFile(widget.chartFile, metric.outputColumns);
    if (!result.ok) throw new HttpError(400, "Invalid chart file for MetricView output", result.code, result);
  } else {
    const fields = new Set(metric.outputColumns.map(column => column.key));
    for (const field of [...widget.fields, widget.valueField, widget.labelField].filter(Boolean))
      if (!fields.has(field)) throw new HttpError(400, `MetricView has no output column: ${field}`, "INVALID_PRODUCT_FIELD");
  }
}

/** Validate a Page binding against the capability signature, not only its parameter name. */
export async function validatePageBindings(owner:ProductOwner,input:ProductAssetInput,read:(id:string)=>Promise<ProductAsset>,credentials:AssistantCredentials){
  if(input.document.kind!=='page')return;
  const signature=input.document.params??{};
  for(const placement of input.document.children){
    const child=await read(placement.assetId),document=child.document;
    if(document.kind==='agent-profile'){
      await validatePageBindings(owner,{...input,document:{...input.document,children:document.tools.map(assetId=>({assetId,column:'main' as const}))}},read,credentials);continue;
    }
    if(!['metric-widget','action-view','collection-view'].includes(document.kind)||!('parameters' in document))continue;
    const bindings=Object.entries(document.parameters).filter(([,binding])=>binding.source==='variable');
    if(!bindings.length)continue;
    let parameters:{name:string;type:string;classNames?:string[]}[]=[];
    if(document.kind==='collection-view')parameters=(await readDefinition(owner,document.renders.id)).parameters;
    if(document.kind==='metric-widget')parameters=(await new DashboardMetricClient(owner.domainId,credentials).describe(document.renders.id)).parameterDefs.map(parameter=>({name:String(parameter.name),type:String(parameter.type),classNames:Array.isArray(parameter.classNames)?parameter.classNames.filter((name):name is string=>typeof name==='string'):undefined}));
    if(document.kind==='action-view'){
      const response=await backendPost('page-action-signature',config.dataQuery.baseUrl+'/action/queryById',{id:document.renders.id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
      const result=JSON.parse(response.text);
      if(!result.success||!Array.isArray(result.data?.function?.parameters))throw new HttpError(400,'Action signature unavailable','PRODUCT_UNAVAILABLE');
      parameters=result.data.function.parameters;
    }
    for(const [name,binding] of bindings){
      if(binding.source!=='variable')continue;
      const source=pageBindingType(signature,binding.path),target=parameters.find(parameter=>parameter.name===name);
      const type=target?.type.replace(/^TYPE_/,'').toLowerCase();
      if(source?.kind==='object'&&type==='ontoobj'&&target?.classNames?.includes(source.objectType))continue;
      if(!source||source.kind!=='scalar'||!type||!({string:['string','text'],number:['number','integer','double','float','long','int','decimal'],boolean:['boolean','bool'],date:['date','datetime','timestamp','time']}[source.type].includes(type)))throw new HttpError(400,`Page binding type does not match capability parameter: ${name}`,'INVALID_PAGE_PARAMETER');
    }
  }
}

export async function validateProduct(owner: ProductOwner, input: ProductAssetInput, credentials: AssistantCredentials) {
  if(input.document.kind==='page'&&input.document.params){
    const allTypes=[...new Set(Object.values(input.document.params).flatMap(parameter=>parameter.kind==='object'?[parameter.objectType]:[]))];
    for(const type of allTypes.filter(type=>type.startsWith('platform:')))platformObjectProvider(type);
    const objectTypes=allTypes.filter(type=>!type.startsWith('platform:'));
    if(objectTypes.length){
      const response=await backendPost('page-parameter-schema',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:objectTypes},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
      const classes=JSON.parse(response.text).classes;
      if(!Array.isArray(classes)||objectTypes.some(name=>!classes.some((object:{className:string})=>object.className===name)))throw new HttpError(400,'Page parameter references an unavailable ObjectType','INVALID_PAGE_PARAMETER');
    }
  }
  if(['metric-widget','action-view','collection-view'].includes(input.document.kind)&&'parameters' in input.document&&Object.values(input.document.parameters).some(binding=>['object','context'].includes(binding.source)))throw new HttpError(400,'Bind projection parameters to typed Page state or literal values','INVALID_PRODUCT_PARAMETER');
  if(input.document.kind==='metric-widget'&&input.document.renderer!=='chart'){
    if(input.document.display){const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(input.document.renders.id);const fields=new Set(metric.outputColumns.map(column=>column.key));if([...(input.document.display.sort??[]).map(sort=>sort.field),...Object.keys(input.document.display.formats??{})].some(field=>!fields.has(field)))throw new HttpError(400,'Display configuration references an unavailable field','INVALID_PRODUCT_FIELD');}
    if(input.document.renderer==='number'&&!input.document.valueField)throw new HttpError(400,'Select a numeric output field','INVALID_PRODUCT_FIELD');
  }
  if(input.document.kind==='collection-view'){
    if(!input.document.fields.length)throw new HttpError(400,'Select collection output fields','INVALID_PRODUCT_FIELD');
    const definition=await readDefinition(owner,input.document.renders.id);
    const objectType=definition.objectType;
    const available=objectType.startsWith('platform:')?Object.keys(platformObjectProvider(objectType).fields):JSON.parse((await backendPost('collection-output-schema',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[objectType]},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1})).text).classes?.find((object:{className:string})=>object.className===objectType)?.attrs?.map((attribute:{name:string})=>attribute.name);
    if(!Array.isArray(available)||input.document.fields.some(field=>!available.includes(field)))throw new HttpError(400,'Collection references an unavailable output field','INVALID_PRODUCT_FIELD');
    if(Object.keys(input.document.parameters).some(name=>!definition.parameters.some(parameter=>parameter.name===name)))throw new HttpError(400,'Collection parameters exceed the Definition signature','INVALID_PRODUCT_PARAMETER');
    for(const parameter of definition.parameters)if(!Object.hasOwn(input.document.parameters,parameter.name)&&parameter.defaultValue===undefined)throw new HttpError(400,`Bind the Definition parameter: ${parameter.name}`,'MISSING_PRODUCT_PARAMETER');
  }
  if(input.document.kind==='object-projection'){
    const objectType=input.document.renders.id;
    if(['text','summary','card','3d'].includes(input.document.renderer)&&!input.document.fields.length)throw new HttpError(400,'ObjectView variants must declare their displayed fields','INVALID_PRODUCT_FIELD');
    if(input.visibility==='domain'&&input.document.primaryKey)throw new HttpError(400,'Shared ObjectViews cannot contain personal object selections','PRIVATE_DEPENDENCY');
    if(input.document.layout){
      if(input.document.layout.className!==objectType)throw new HttpError(400,'ObjectView layout must belong to its rendered ObjectType','INVALID_PRODUCT_TARGET');
      const issues=objectProjectionIssues(input.document.layout);
      if(issues.length)throw new HttpError(400,issues.join('; '),'LEGACY_INLINE_LOGIC');
      for(const widget of input.document.layout.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
        if(!widget.resourceId)continue;
        if(widget.kind==='action')await validateProduct(owner,{name:widget.title||widget.id,description:'',visibility:'private',document:{kind:'widget',widget:{...widget,parameters:Object.fromEntries(Object.entries(widget.parameters).map(([name,binding])=>[name,binding.source==='context'?{source:'literal' as const,value:'object-context'}:binding]))}}},credentials);
        else if(['properties','links','metric','table','chart'].includes(widget.kind)){
          const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(widget.resourceId);
          if(metric.status!=='PUBLISHED')throw new HttpError(400,'Publish the MetricView first','UNPUBLISHED_CAPABILITY');
          validateMetricFields(widget, metric);
          const parameters=new Set(metric.parameterDefs.map(parameter=>String(parameter.name)));
          if(Object.keys(widget.parameters).some(name=>!parameters.has(name)))throw new HttpError(400,'Unknown capability parameter','INVALID_PRODUCT_PARAMETER');
          for(const parameter of metric.parameterDefs)if(!Object.hasOwn(widget.parameters,String(parameter.name))&&(!Object.hasOwn(parameter,'value')||parameter.value===null))throw new HttpError(400,`Bind the MetricView parameter: ${parameter.name}`,'MISSING_PRODUCT_PARAMETER');
        }
      }
    }
    const result=objectType.startsWith('platform:')?{classes:[{className:objectType,attrs:Object.entries(platformObjectProvider(objectType).fields).map(([name,type])=>({name,type,primaryKey:name==='id'}))}],relationships:[]}:JSON.parse((await backendPost('product-object-type',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[objectType]}, {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1})).text);
    const classes=result.classes;
    if(!Array.isArray(classes)||!classes.some((item:{className:string})=>item.className===objectType))throw new HttpError(400,'Object type unavailable','PRODUCT_UNAVAILABLE');
    const object=classes.find((item:{className:string})=>item.className===objectType);
    const fields=new Set(object.attrs?.map((attribute:{name:string})=>attribute.name)??[]);
    if(input.document.fields.some(field=>!fields.has(field)))throw new HttpError(400,'ObjectView references an unavailable attribute','INVALID_PRODUCT_FIELD');
    if(input.document.layout)for(const widget of input.document.layout.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
      if(widget.kind==='properties'&&!widget.resourceId&&widget.fields.some(field=>!fields.has(field)))throw new HttpError(400,'ObjectView references an unavailable attribute','INVALID_PRODUCT_FIELD');
      if(widget.kind==='links'&&!widget.resourceId&&!result.relationships?.some((relation:{name:string;fromclass:string;toclass:string})=>relation.name===widget.relation&&(widget.direction==='outgoing'?relation.fromclass:relation.toclass)===objectType))throw new HttpError(400,'ObjectView references an unavailable relationship','INVALID_PRODUCT_FIELD');
    }
  }
  const platform=platformWidget(input.document);
  if(input.visibility==='domain'&&platform?.workspace&&(platform.workspace.pinnedObjects.length||platform.workspace.pinnedAnalyses.length||platform.workspace.agentIds.length))throw new HttpError(400,'Shared components cannot contain personal selections','PRIVATE_DEPENDENCY');
  if(input.document.kind === "object-view") {
    if(input.visibility === "domain" && input.document.primaryKey) throw new HttpError(400,"Shared object views must not contain a personal object selection","PRIVATE_DEPENDENCY");
    const response=await backendPost("product-object-view",config.dataQuery.baseUrl+"/objectView/read",{className:input.document.className,form:input.document.form},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
    const state=JSON.parse(response.text);
     if(!state.success || !state.data?.publishedRevision || !state.data?.versions?.length) throw new HttpError(400,"Publish the class object view before referencing it","UNPUBLISHED_OBJECT_VIEW");
      const published=state.data.versions.find((version:{revision:number})=>version.revision===state.data.publishedRevision);
      if(!published)throw new HttpError(400,'Published ObjectView revision unavailable','UNPUBLISHED_OBJECT_VIEW');
      const document=objectViewDocumentSchema.parse(published.document);
     const issues=objectViewProductIssues(document);
     if(issues.length) throw new HttpError(400,issues.join("; "),"LEGACY_INLINE_LOGIC");
     for(const widget of document.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
       if(!widget.resourceId)continue;
       if(widget.kind==='action'){
         await validateProduct(owner,{name:widget.title||widget.id,description:'',visibility:'private',document:{kind:'widget',widget:{...widget,parameters:Object.fromEntries(Object.entries(widget.parameters).map(([name,binding])=>[name,binding.source==='context'?{source:'literal' as const,value:'object-context'}:binding]))}}},credentials);
       }else if(['properties','links','metric','table','chart'].includes(widget.kind)){
         const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(widget.resourceId);
         if(metric.status!=='PUBLISHED')throw new HttpError(400,'Publish the MetricView first','UNPUBLISHED_CAPABILITY');
         validateMetricFields(widget, metric);
         const parameters=new Set(metric.parameterDefs.map(parameter=>String(parameter.name)));
         if(Object.keys(widget.parameters).some(name=>!parameters.has(name)))throw new HttpError(400,'Unknown capability parameter','INVALID_PRODUCT_PARAMETER');
         for(const definition of metric.parameterDefs)if(!Object.hasOwn(widget.parameters,String(definition.name))&&(!Object.hasOwn(definition,'value')||definition.value===null))throw new HttpError(400,`Bind the MetricView parameter: ${definition.name}`,'MISSING_PRODUCT_PARAMETER');
       }
     }
  }
   if(input.visibility === "domain" && "workspace" in input.document && input.document.workspace && (input.document.workspace.pinnedObjects.length || input.document.workspace.pinnedAnalyses.length || input.document.workspace.agentIds.length))
    throw new HttpError(400,"Shared templates cannot include personal object, conversation or agent bookmarks","PRIVATE_DEPENDENCY");
  const client = new DashboardMetricClient(owner.domainId, credentials);
  const widgets = productWidgets(input.document);
  for (const reference of productReferences(input.document)) {
    if (reference.kind === "metric") {
      const metric = await client.describe(reference.id);
      if (metric.status !== "PUBLISHED") throw new HttpError(400,"Publish the MetricView first","UNPUBLISHED_CAPABILITY");
      for (const widget of widgets.filter(widget => widget.resourceId === reference.id)) {
        validateMetricFields(widget, metric);
        const parameters = new Set(metric.parameterDefs.map(parameter => String(parameter.name)));
        if (Object.keys(widget.parameters).some(name => !parameters.has(name))) throw new HttpError(400,"Unknown capability parameter","INVALID_PRODUCT_PARAMETER");
        for(const definition of metric.parameterDefs){
          const name=String(definition.name);
          if(!Object.hasOwn(widget.parameters,name)&&(!Object.hasOwn(definition,'value')||definition.value===null))
            throw new HttpError(400,`Bind the MetricView parameter: ${name}`,'MISSING_PRODUCT_PARAMETER');
        }
      }
    }
    if (reference.kind === "action") {
      const response = await backendPost("product-action", config.dataQuery.baseUrl + "/action/queryById", {id:reference.id}, {
        headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1,
      });
      const result = JSON.parse(response.text);
      if (!result.success || result.data?.status !== "PUBLISHED") throw new HttpError(400,"Action unavailable or unpublished","UNPUBLISHED_CAPABILITY");
      const formResponse=await backendPost("product-action-form",config.dataQuery.baseUrl+"/action/form",{id:reference.id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
      const form=JSON.parse(formResponse.text);
      if(!form.success || !Array.isArray(form.data?.fields)) throw new HttpError(400,"Action form unavailable","PRODUCT_UNAVAILABLE");
      const fields=new Set(form.data.fields.map((field:{key:string})=>field.key));
      if(widgets.filter(widget=>widget.resourceId===reference.id).some(widget=>Object.keys(widget.parameters).some(name=>!fields.has(name))))
        throw new HttpError(400,"Unknown Action parameter","INVALID_PRODUCT_PARAMETER");
      if(widgets.filter(widget=>widget.resourceId===reference.id).some(widget=>widget.kind!=='chart'&&widget.readOnlyParameters.some(name=>!fields.has(name)||!Object.hasOwn(widget.parameters,name))))
        throw new HttpError(400,'Read-only Action parameters must exist and have a binding','INVALID_PRODUCT_PARAMETER');
    }
    if (reference.kind === "dashboard") {
      // Existing dashboards are personal. Shared templates use reusable capability widgets instead.
      if (input.visibility === "domain") throw new HttpError(400,"Shared assets must use MetricView widgets instead of personal dashboards","PRIVATE_DEPENDENCY");
      const dashboard = await getOwnedDashboard(owner.userId, owner.domainId, reference.id);
       if (dashboard.groups.some(group => [...group.charts,...group.metrics].some(card => card.query?.kind !== "metric")))
         throw new HttpError(400,"Migrate legacy inline dashboard logic to published MetricViews first","LEGACY_INLINE_LOGIC");
       for(const group of dashboard.groups)for(const card of [...group.charts,...group.metrics]){
         if(card.query?.kind!=='metric')continue;
         const metric=await client.describe(card.query.metricId);
         if(metric.status!=='PUBLISHED')throw new HttpError(400,'Publish the MetricView first','UNPUBLISHED_CAPABILITY');
         const parameters=new Set(metric.parameterDefs.map(parameter=>String(parameter.name)));
         if(Object.keys(card.query.parameters).some(name=>!parameters.has(name)))throw new HttpError(400,'Unknown capability parameter','INVALID_PRODUCT_PARAMETER');
       }
    }
    if (reference.kind === "application") {
      if(input.document.kind==='application'&&!input.document.workspaceId&&input.document.navigationId)continue;
      const response = await backendGet("product-application", config.dataQuery.baseUrl + `/platform/applications/${encodeURIComponent(reference.id)}`, {
        headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey), retries:1,
      });
      if (JSON.parse(response.text).success === false) throw new HttpError(400,"Application unavailable","PRODUCT_UNAVAILABLE");
    }
  }
}
