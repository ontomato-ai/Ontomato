<script setup lang="ts">
import {computed,useId,ref,onMounted,onBeforeUnmount} from 'vue';
import {ElButton} from 'element-plus';
import ProductGraphDialog from './ProductGraphDialog.vue';
import {type ProductGraph} from '@ontomato/contracts/product-graph';
import {productTypes} from '@ontomato/contracts/product-assets';
import {useOntologyText} from '../context';
import {localizedProductTypes,localizedProductCategories} from './catalog-labels';
const props=defineProps<{graph:ProductGraph;expanded?:boolean}>();
const fullscreen=ref(false),scale=ref(1),canvas=ref<HTMLElement>();
function fit(){if(canvas.value)scale.value=Math.max(.08,Math.min(1,(canvas.value.clientWidth-32)/width.value,(canvas.value.clientHeight-32)/height.value));}
let observer:ResizeObserver|undefined;
onMounted(()=>{if(props.expanded&&canvas.value){observer=new ResizeObserver(fit);observer.observe(canvas.value);fit();}});
onBeforeUnmount(()=>observer?.disconnect());
const emit=defineEmits<{open:[id:string]}>();
const graphId=useId().replace(/:/g,'');
const {ot}=useOntologyText();
const focusedNode=ref<string|null>(null);
function related(edge:ProductGraph['edges'][number]){return edge.source===focusedNode.value||edge.target===focusedNode.value;}
const columns=computed(()=>[{id:'principal',name:'主体与角色'},...localizedProductCategories(ot),{id:'ontology',name:'本体元素'},{id:'legacy',name:'待迁移资产'}]);
function nodeLabel(node:ProductGraph['nodes'][number]){if(node.kind==='page')return node.isTemplate?'页面模板':node.embeddable?'可嵌入页面':ot('productPage');return localizedProductTypes(ot).find(type=>type.kind===node.kind)?.name??({'object-type':'对象类型',metric:'指标视图',action:'动作',definition:'业务定义',application:'应用身份',AgentPrincipal:'智能体主体',principal:'主体',role:'角色',domain:'域内成员'} as Record<string,string>)[node.kind]??node.kind;}
function columnNodes(id:string){return props.graph.nodes.filter(node=>node.category===id).sort((a,b)=>{
  const rank=(kind:string)=>{const index=productTypes.findIndex(type=>type.kind===kind);return index<0?productTypes.length:index;};
  return rank(a.kind)-rank(b.kind)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
});}
const visibleColumns=computed(()=>columns.value.filter(column=>props.graph.nodes.some(node=>node.category===column.id)));
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
   <div class="asset-graph"><div class="graph-controls"><span>{{graph.nodes.length}} 个节点 · {{graph.edges.length}} 条关系</span><ElButton v-if="!expanded" @click="fullscreen=true">展开查看</ElButton><ElButton :disabled="scale<=.08" @click="scale=Math.max(.08,scale/1.25)">缩小</ElButton><span>{{Math.round(scale*100)}}%</span><ElButton :disabled="scale>=2" @click="scale=Math.min(2,scale*1.25)">放大</ElButton><ElButton @click="fit">适应画布</ElButton><ElButton @click="scale=1">原始大小</ElButton></div><p class="graph-caption">引用箭头指向被引用资产；使用与编辑授权从主体指向应用。仅显示当前可见资产，授权明细限可编辑应用。缩放查看全图，滚动查看细节。</p><div ref="canvas" class="graph-canvas"><svg :viewBox="`0 0 ${width} ${height}`" :style="{width:`${width*scale}px`,height:`${height*scale}px`}" role="img" aria-label="产品资产分层引用图">
     <defs><marker :id="`${graphId}-arrow`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M 2 1 L 8 5 L 2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
    <text v-for="(column,index) in visibleColumns" :key="column.id" :x="index*300+10" y="22" class="column-label">{{column.name}}</text>
    <g v-for="(edge,index) in graph.edges" :key="`${edge.source}:${edge.target}:${edge.relation}`" :class="{'related-edge':related(edge),'muted-edge':focusedNode&&!related(edge)}"><title>{{labels[edge.relation]}}</title><path :id="`${graphId}-edge-${index}`" :d="edgePath(edge)" class="edge" :marker-end="`url(#${graphId}-arrow)`"/><text v-if="related(edge)" class="edge-label"><textPath :href="`#${graphId}-edge-${index}`" startOffset="45%">{{labels[edge.relation]}}</textPath></text></g>
     <g v-for="node in graph.nodes" :key="node.id" :transform="`translate(${positions.get(node.id)!.x},${positions.get(node.id)!.y})`" :class="['node',{'is-asset':node.assetId}]" :role="node.assetId?'link':undefined" :tabindex="node.assetId?0:undefined" @mouseenter="focusedNode=node.id" @mouseleave="focusedNode=null" @focus="focusedNode=node.id" @blur="focusedNode=null" @click="node.assetId&&emit('open',node.assetId)" @keydown.enter="node.assetId&&emit('open',node.assetId)"><title>{{node.name}} · {{nodeLabel(node)}} · {{node.assetId??node.id}}</title><rect width="220" height="54" rx="6"/><svg x="10" y="6" width="200" height="24"><text x="0" y="16">{{node.name}}</text></svg><text x="10" y="42" class="node-kind">{{nodeLabel(node)}}{{node.revision?` · r${node.revision}`:''}}</text></g>
    </svg></div><ProductGraphDialog v-if="!expanded" v-model="fullscreen" :graph="graph" @open="emit('open',$event)"/></div>
</template>
<style scoped>
.asset-graph{min-width:0;max-width:100%;border:1px solid var(--el-border-color-light);border-radius:var(--radius-md);overflow:hidden}.graph-caption{margin:0;padding:var(--spacing-md);font-size:var(--text-xs);line-height:var(--leading-sm);color:var(--el-text-color-secondary);border-bottom:1px solid var(--el-border-color-light)}.graph-canvas{overflow:auto;max-height:480px;padding:var(--spacing-sm);overscroll-behavior:contain}svg{display:block;font-size:12px;color:var(--el-text-color-secondary)}.column-label{fill:var(--el-text-color-primary);font-weight:600}.edge{fill:none;stroke:var(--el-border-color-dark);stroke-width:1.5}.edge-label{fill:var(--el-text-color-secondary);font-size:10px}.node rect{fill:var(--el-bg-color);stroke:var(--el-border-color)}.node text{fill:var(--el-text-color-primary)}.node .node-kind{fill:var(--el-text-color-secondary);font-size:10px}.is-asset{cursor:pointer}.is-asset:hover rect,.is-asset:focus rect{stroke:var(--el-color-primary)}
.asset-graph svg .node rect{fill:var(--el-bg-color);stroke:var(--el-border-color);stroke-width:1}.asset-graph svg .node:hover rect,.asset-graph svg .node:focus rect{stroke:var(--el-color-primary);stroke-width:1.5}.asset-graph .edge{stroke-width:1;opacity:.65}.asset-graph .related-edge .edge{stroke:var(--el-color-primary);stroke-width:1.5;opacity:1}.muted-edge{opacity:.15}.edge-label{paint-order:stroke;stroke:var(--el-bg-color);stroke-width:3px;stroke-linejoin:round}
</style>
<style scoped>.graph-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px;border-bottom:1px solid var(--el-border-color-light)}.graph-controls>span:first-child{margin-inline-end:auto}.graph-controls>span{font-size:var(--text-xs);color:var(--el-text-color-secondary)}.graph-controls :deep(.el-button+.el-button){margin:0}.graph-canvas{min-height:320px}.graph-controls,.graph-caption{flex-shrink:0}</style>
