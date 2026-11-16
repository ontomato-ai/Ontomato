<script setup lang="ts">
import {computed,useId} from 'vue';
import {productCategories,type ProductGraph} from '@ontomato/contracts/product-graph';
import {productTypes} from '@ontomato/contracts/product-assets';
import {useOntologyText} from '../context';
const props=defineProps<{graph:ProductGraph}>();
const emit=defineEmits<{open:[id:string]}>();
const graphId=useId().replace(/:/g,'');
const {ot}=useOntologyText();
const columns:{id:string;name:string}[]=[{id:'principal',name:'主体与角色'},...[...productCategories].reverse(),{id:'ontology',name:'本体元素'},{id:'legacy',name:'待迁移资产'}];
function nodeLabel(node:ProductGraph['nodes'][number]){if(node.kind==='agent-profile')return ot('productAgentProfile');if(node.kind==='page')return node.isTemplate?'布局模板':node.embeddable?'可嵌入页':'页面';return productTypes.find(type=>type.kind===node.kind)?.name??({'object-type':'对象类型',metric:'指标能力',action:'操作能力',definition:'业务定义',application:'应用身份',AgentPrincipal:'智能体主体',principal:'主体',role:'角色',domain:'域内成员'} as Record<string,string>)[node.kind]??node.kind;}
function columnNodes(id:string){return props.graph.nodes.filter(node=>node.category===id).sort((a,b)=>{
  const rank=(kind:string)=>{const index=productTypes.findIndex(type=>type.kind===kind);return index<0?productTypes.length:index;};
  return rank(a.kind)-rank(b.kind)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
});}
const visibleColumns=computed(()=>columns.filter(column=>props.graph.nodes.some(node=>node.category===column.id)));
const positions=computed(()=>{
  const result=new Map<string,{x:number;y:number}>();
  visibleColumns.value.forEach((column,index)=>columnNodes(column.id).forEach((node,row)=>result.set(node.id,{x:index*300+10,y:row*94+44})));
  return result;
});
const width=computed(()=>Math.max(300,visibleColumns.value.length*300));
const height=computed(()=>Math.max(160,...visibleColumns.value.map(column=>columnNodes(column.id).length*94+50)));
const labels:Record<string,string>={renders:'呈现',contains:'组合',navigates:'导航',tools:'工具',context:'上下文',embodies:'具身',identity:'应用身份','depends-on':'依赖',use:'使用授权',edit:'编辑授权'};
function edgePath(edge:ProductGraph['edges'][number]){
  const from=positions.value.get(edge.source)!,to=positions.value.get(edge.target)!;
  if(from.x===to.x){const side=from.x+220;return `M ${side} ${from.y+27} C ${side+64} ${from.y+27}, ${side+64} ${to.y+27}, ${side} ${to.y+27}`;}
  const forward=to.x>from.x,direction=forward?1:-1;
  const start={x:from.x+(forward?220:0),y:from.y+27};
  const end={x:to.x+(forward?0:220),y:to.y+27};
  const offset=edge.relation==='edit'?18:0;
  return `M ${start.x} ${start.y} C ${start.x+60*direction} ${start.y+offset}, ${end.x-60*direction} ${end.y+offset}, ${end.x} ${end.y}`;
}
</script>
<template>
  <div class="asset-graph"><p class="graph-caption">引用箭头指向被引用资产；使用与编辑授权从主体指向应用。页面可嵌入智能体配置，智能体配置引用工具与上下文元素。仅显示当前可见资产，授权明细限可编辑应用。</p><svg :viewBox="`0 0 ${width} ${height}`" :style="{minWidth:`${width}px`,height:`${height}px`}" role="img" aria-label="产品资产分层引用图">
    <defs><marker :id="`${graphId}-arrow`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
    <text v-for="(column,index) in visibleColumns" :key="column.id" :x="index*300+10" y="22" class="column-label">{{column.name}}</text>
    <g v-for="(edge,index) in graph.edges" :key="`${edge.source}:${edge.target}:${edge.relation}`"><path :id="`${graphId}-edge-${index}`" :d="edgePath(edge)" class="edge" :marker-end="`url(#${graphId}-arrow)`"/><text class="edge-label"><textPath :href="`#${graphId}-edge-${index}`" startOffset="45%">{{labels[edge.relation]}}</textPath></text></g>
    <g v-for="node in graph.nodes" :key="node.id" :transform="`translate(${positions.get(node.id)!.x},${positions.get(node.id)!.y})`" :class="['node',{'is-asset':node.assetId}]" :role="node.assetId?'link':undefined" :tabindex="node.assetId?0:undefined" @click="node.assetId&&emit('open',node.assetId)" @keydown.enter="node.assetId&&emit('open',node.assetId)"><title>{{node.name}} · {{node.kind}}</title><rect width="220" height="54" rx="6"/><text x="10" y="22">{{node.name.length>20?node.name.slice(0,19)+'…':node.name}}</text><text x="10" y="42" class="node-kind">{{nodeLabel(node)}}{{node.revision?` · r${node.revision}`:''}}</text></g>
  </svg></div>
</template>
<style scoped>
.asset-graph{overflow:auto;max-height:560px;padding:var(--spacing-sm);border:1px solid var(--el-border-color-light)}svg{display:block;width:100%;font-size:12px;color:var(--el-text-color-secondary)}.column-label{fill:var(--el-text-color-primary);font-weight:600}.edge{fill:none;stroke:var(--el-border-color-dark);stroke-width:1.5}.edge-label{fill:var(--el-text-color-secondary);font-size:10px}.node rect{fill:var(--el-bg-color);stroke:var(--el-border-color)}.node text{fill:var(--el-text-color-primary)}.node .node-kind{fill:var(--el-text-color-secondary);font-size:10px}.is-asset{cursor:pointer}.is-asset:hover rect,.is-asset:focus rect{stroke:var(--el-color-primary)}
</style>
