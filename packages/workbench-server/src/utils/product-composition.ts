import {productAssetInputSchema,type ProductAssetInput} from '@ontomato/contracts/product-assets';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';
import {createHash} from 'node:crypto';

/** Deterministic child IDs keep migrations and authoring retries on the same composition. */
export function normalizeComposition(id:string,input:ProductAssetInput):{input:ProductAssetInput;children:{id:string;input:ProductAssetInput}[]}{
  const document=input.document;
  if(document.kind==='widget'&&document.widget.kind!=='platform'){
    const widget=document.widget;
    const presentation={fieldLabels:widget.fieldLabels,fieldOptions:widget.fieldOptions,variable:widget.variable};
    if(['metric','table'].includes(widget.kind))return {input:productAssetInputSchema.parse({...input,document:{kind:'metric-widget',presentation,renders:{kind:'MetricView',id:widget.resourceId},renderer:widget.kind==='metric'?'number':widget.kind,parameters:widget.parameters,fields:widget.fields,valueField:widget.valueField,labelField:widget.labelField,chartType:widget.chartType,height:widget.height}}),children:[]};
    if(widget.kind==='action')return {input:productAssetInputSchema.parse({...input,document:{kind:'action-view',presentation,renders:{kind:'Action',id:widget.resourceId},renderer:'form',parameters:widget.parameters,readOnlyParameters:widget.readOnlyParameters}}),children:[]};
  }
  if(document.kind==='layout-template')return {input:{...input,document:{...document,kind:'page' as const,isTemplate:true,compositionVersion:2 as const}},children:[]};
  if(document.kind!=='widget-group'&&document.kind!=='operation-panel')return {input,children:[]};
  const children=document.widgets.map(widget=>{
    const childId=`projection-${createHash('sha256').update(`${id}:${widget.id}`).digest('hex').slice(0,40)}`;
    const childInput=productAssetInputSchema.parse({name:widget.title||input.name,description:'',visibility:input.visibility,document:{kind:'widget',widget}});
    return {id:childId,input:normalizeComposition(childId,childInput).input};
  });
  return {input:productAssetInputSchema.parse({...input,document:{kind:'page',workspace:defaultPersonalWorkspace(),embeddable:document.kind==='widget-group',compositionVersion:2,children:children.map((child,index)=>({assetId:child.id,column:'main',width:document.widgets[index].span}))}}),children};
}
