import { productReferences, productWidgets, type ProductAssetInput } from "@ontomato/contracts/product-assets";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { DashboardMetricClient } from "../dashboard/metric-client";
import { getOwnedDashboard } from "../dashboard/access";
import { config } from "../../config/application";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "./store";
import { objectViewDocumentSchema, objectViewProductIssues } from "@ontomato/contracts/object-views";

export async function validateProduct(owner: ProductOwner, input: ProductAssetInput, credentials: AssistantCredentials) {
  if(input.document.kind === "object-view") {
    if(input.visibility === "domain" && input.document.primaryKey) throw new HttpError(400,"Shared object views must not contain a personal object selection","PRIVATE_DEPENDENCY");
    const response=await backendPost("product-object-view",config.dataQuery.baseUrl+"/objectView/read",{className:input.document.className,form:input.document.form},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
    const state=JSON.parse(response.text);
     if(!state.success || !state.data?.publishedRevision || !state.data?.versions?.length) throw new HttpError(400,"Publish the class object view before referencing it","UNPUBLISHED_OBJECT_VIEW");
     const document=objectViewDocumentSchema.parse(state.data.versions[0].document);
     const issues=objectViewProductIssues(document);
     if(issues.length) throw new HttpError(400,issues.join("; "),"LEGACY_INLINE_LOGIC");
     for(const widget of document.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
       if(!widget.resourceId)continue;
       if(widget.kind==='action'){
         await validateProduct(owner,{name:widget.title||widget.id,description:'',visibility:'private',document:{kind:'widget',widget:{...widget,parameters:Object.fromEntries(Object.entries(widget.parameters).map(([name,binding])=>[name,binding.source==='context'?{source:'literal' as const,value:'object-context'}:binding]))}}},credentials);
       }else if(['properties','links','metric','table','chart'].includes(widget.kind)){
         const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(widget.resourceId);
         if(metric.status!=='PUBLISHED')throw new HttpError(400,'Publish the MetricView first','UNPUBLISHED_CAPABILITY');
         const fields=new Set(metric.outputColumns.map(column=>column.key));
         for(const field of [...widget.fields,widget.valueField,widget.labelField].filter(Boolean))if(!fields.has(field))throw new HttpError(400,`MetricView has no output column: ${field}`,'INVALID_PRODUCT_FIELD');
         const parameters=new Set(metric.parameterDefs.map(parameter=>String(parameter.name)));
         if(Object.keys(widget.parameters).some(name=>!parameters.has(name)))throw new HttpError(400,'Unknown capability parameter','INVALID_PRODUCT_PARAMETER');
         for(const definition of metric.parameterDefs)if(!Object.hasOwn(widget.parameters,String(definition.name))&&(!Object.hasOwn(definition,'value')||definition.value===null))throw new HttpError(400,`Bind the MetricView parameter: ${definition.name}`,'MISSING_PRODUCT_PARAMETER');
       }
     }
  }
  if(input.visibility === "domain" && "workspace" in input.document && (input.document.workspace.pinnedObjects.length || input.document.workspace.pinnedAnalyses.length || input.document.workspace.agentIds.length))
    throw new HttpError(400,"Shared templates cannot include personal object, conversation or agent bookmarks","PRIVATE_DEPENDENCY");
  const client = new DashboardMetricClient(owner.domainId, credentials);
  const widgets = productWidgets(input.document);
  for (const reference of productReferences(input.document)) {
    if (reference.kind === "metric") {
      const metric = await client.describe(reference.id);
      if (metric.status !== "PUBLISHED") throw new HttpError(400,"Publish the MetricView first","UNPUBLISHED_CAPABILITY");
      for (const widget of widgets.filter(widget => widget.resourceId === reference.id)) {
        const fields = new Set(metric.outputColumns.map(column => column.key));
        for (const field of [...widget.fields, widget.valueField, widget.labelField].filter(Boolean)) {
          if (!fields.has(field)) throw new HttpError(400, `MetricView has no output column: ${field}`, "INVALID_PRODUCT_FIELD");
        }
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
      if(widgets.filter(widget=>widget.resourceId===reference.id).some(widget=>widget.readOnlyParameters.some(name=>!fields.has(name)||!Object.hasOwn(widget.parameters,name))))
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
      const response = await backendGet("product-application", config.dataQuery.baseUrl + `/platform/applications/${encodeURIComponent(reference.id)}`, {
        headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey), retries:1,
      });
      if (JSON.parse(response.text).success === false) throw new HttpError(400,"Application unavailable","PRODUCT_UNAVAILABLE");
    }
  }
}
