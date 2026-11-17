<script setup lang="ts">
import {watch,ref,computed} from "vue";
import {useRouter,useRoute} from "vue-router";
import {validatePageState,validateProductNavigation} from '@ontomato/contracts/product-page-state';
import {productAssetSchema,type ProductAsset} from "@ontomato/contracts/product-assets";
import {nodeApiRequest} from "@ontomato/workbench-ui";
import {ManagerFrame,ProductAssetRuntime,useProductText} from "@ontomato/ontology-manager";
import PersonalWorkspace from "./PersonalWorkspaceRoute.vue";
import {ElAlert,ElButton} from 'element-plus';
import {useI18n} from 'vue-i18n';
const props=defineProps<{productAssetId:string;embedded?:boolean;applicationId?:string}>();
const {t}=useI18n();
const productText=useProductText();
const router=useRouter(),asset=ref<ProductAsset|null>(null),children=ref<ProductAsset[]>([]),error=ref("");
const route=useRoute();
const unavailableAssets=ref<string[]>([]);
const rootUnavailable=computed(()=>unavailableAssets.value.includes(props.productAssetId));
const stateError=ref('');
const navigationPage=ref('');
const selectedPage=computed(()=>navigationPage.value?children.value.find(child=>child.id===navigationPage.value):undefined);
const stateSignature=computed(()=>{const document=selectedPage.value?.document??asset.value?.document;return document?.kind==='page'?document.params??{}:document?.kind==='object-projection'?{selected:{kind:'object' as const,objectType:document.renders.id}}:{};});
const pageState=computed(()=>{
  if(typeof route.query.state!=='string')return {};
  try{return validatePageState(stateSignature.value,JSON.parse(route.query.state));}catch{return {};}
});
watch(()=>[route.query.state,asset.value,selectedPage.value],()=>{stateError.value='';if(asset.value&&typeof route.query.state==='string')try{validatePageState(stateSignature.value,JSON.parse(route.query.state));}catch(reason){stateError.value=reason instanceof Error?reason.message:'Invalid page state';}},{immediate:true});
const applicationNavigation=computed(()=>{const root=asset.value?.document;return root?.kind==='application'?children.value.find(child=>child.id===root.navigationId):undefined;});
const publishedChildren=computed(()=>props.applicationId?children.value:undefined);
function navigate(id:string){
  if(props.applicationId){try{validateProductNavigation(children.value,id);navigationPage.value=id;}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}}
  else void router.push('/products/'+encodeURIComponent(id));
}
let generation=0;
const directChildren=computed(()=>asset.value&&'children' in asset.value.document?asset.value.document.children.flatMap(reference=>children.value.find(child=>child.id===reference.assetId)??[]):[]);
const visibleDirectChildren=computed(()=>directChildren.value.filter(child=>!unavailableAssets.value.includes(child.id)));
watch(()=>[props.productAssetId,props.applicationId,route.query.navigationPath],async()=>{const current=++generation;asset.value=null;children.value=[];unavailableAssets.value=[];navigationPage.value='';error.value='';try{
  const request=async(id:string)=>{const response=await nodeApiRequest(`/api/product-assets/${encodeURIComponent(id)}`);const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Asset unavailable');return productAssetSchema.parse(body.asset);};
   if(props.applicationId){
     const response=await nodeApiRequest(`/api/product-assets/published/${encodeURIComponent(props.applicationId)}/${encodeURIComponent(props.productAssetId)}`);const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Product contract unavailable');
       if(current!==generation)return;asset.value=productAssetSchema.parse(body.asset);children.value=body.assets.map((item:unknown)=>productAssetSchema.parse(item));unavailableAssets.value=(body.issues??[]).map((issue:{assetId:string})=>issue.assetId);
    }else{const loaded=await request(props.productAssetId);const loadedChildren='children' in loaded.document?await Promise.all(loaded.document.children.map(child=>request(child.assetId))):[];if(current!==generation)return;asset.value=loaded;children.value=loadedChildren;}
     if(asset.value?.document.kind==='navigation'){
      const navigation=asset.value.document;
      if(!props.applicationId){const pages=await Promise.all(navigation.nodes.map(node=>request(node.pageId)));if(current!==generation)return;children.value=pages;}
      const requested=typeof route.query.navigationPath==='string'?route.query.navigationPath:undefined;navigationPage.value=(requested?navigation.nodes.find(node=>node.path===requested):navigation.nodes.find(node=>node.id===navigation.entry))?.pageId??'';if(!navigationPage.value)throw new Error('Navigation path unavailable');
     }
     if(asset.value?.document.kind==='application'&&asset.value.document.navigationId){
       const navigationId=asset.value.document.navigationId;
       const navigation=children.value.find(child=>child.id===navigationId)?.document;
       if(navigation?.kind!=='navigation')throw new Error('Application Navigation unavailable');
        const requested=typeof route.query.navigationPath==='string'?route.query.navigationPath:undefined;
        navigationPage.value=(requested?navigation.nodes.find(node=>node.path===requested):navigation.nodes.find(node=>node.id===navigation.entry))?.pageId??'';
        if(!navigationPage.value)throw new Error('Navigation path unavailable');
     }
 }catch(e){if(current===generation)error.value=e instanceof Error?e.message:String(e);}},{immediate:true});
</script>
<template>
  <el-alert v-if="stateError" :title="stateError" type="error" :closable="false"/>
  <el-alert v-else-if="rootUnavailable" :title="t('ontology.productReleaseContractChanged')" type="error" :closable="false"/>
  <ManagerFrame v-else-if="!error&&asset?.document.kind==='object-projection'"><ProductAssetRuntime :asset="asset" :page-state="pageState"/></ManagerFrame>
  <section v-else-if="!error&&asset?.document.kind==='application'&&applicationNavigation" class="product-application"><ManagerFrame class="product-navigation"><ProductAssetRuntime :asset="applicationNavigation" @navigate="navigate"/></ManagerFrame><div class="product-application-content"><PersonalWorkspace v-if="selectedPage" :key="selectedPage.id" :product-asset-id="selectedPage.id" :pinned-assets="publishedChildren" :unavailable-assets="unavailableAssets" :embedded="embedded" :page-state="pageState"/></div></section>
  <PersonalWorkspace v-else-if="!error&&asset?.document.kind==='page'" :product-asset-id="productAssetId" :pinned-assets="applicationId?children:undefined" :embedded="embedded" :page-state="pageState" :unavailable-assets="unavailableAssets"/>
   <section v-else class="product-page" :class="{'is-embedded':embedded}"><el-alert v-if="error" :title="error" type="error" :closable="false"/><template v-if="asset&&!error"><h1 v-if="!embedded">{{productText(asset.name)}}</h1><p v-if="!embedded">{{productText(asset.description)}}</p><el-alert v-if="directChildren.some(child=>unavailableAssets.includes(child.id))" :title="t('ontology.productProjectionContractChanged')" type="error" :closable="false"/><ManagerFrame><ProductAssetRuntime :asset="asset" @navigate="navigate"/><section v-for="child in visibleDirectChildren" :key="child.id"><el-button v-if="child.document.kind==='page'" @click="navigate(child.id)">{{productText(child.name)}}</el-button><ProductAssetRuntime v-else :asset="child" @navigate="navigate"/></section></ManagerFrame><PersonalWorkspace v-if="selectedPage" :key="selectedPage.id" :product-asset-id="selectedPage.id" :pinned-assets="publishedChildren" :unavailable-assets="unavailableAssets" :embedded="embedded"/></template></section>
</template>
<style scoped>
.product-application{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}
.product-navigation{flex:0 0 auto;height:auto;container-type:inline-size;contain:none;border-bottom:1px solid var(--el-border-color-light)}
.product-navigation :deep(.ontology-manager-shell){height:auto;overflow:visible;padding:8px 16px}
.product-application-content{flex:1;min-height:0;overflow:auto}
</style>
<style scoped>.product-page{padding:24px;max-width:1280px;width:100%;box-sizing:border-box;margin:auto}.product-page section{margin:20px 0}.product-page.is-embedded{padding:0;max-width:none}.product-page>:deep(.ontology-manager){height:auto;container-type:inline-size;contain:none}.product-page :deep(.ontology-manager-shell){height:auto;overflow:visible}</style>
