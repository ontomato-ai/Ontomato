<script setup lang="ts">
import {watch,ref} from "vue";
import {useRouter} from "vue-router";
import {productAssetSchema,type ProductAsset} from "@ontomato/contracts/product-assets";
import {nodeApiRequest} from "@ontomato/workbench-ui";
import {ManagerFrame,ProductAssetRuntime} from "@ontomato/ontology-manager";
import PersonalWorkspace from "./PersonalWorkspaceRoute.vue";
const props=defineProps<{productAssetId:string}>();
const router=useRouter(),asset=ref<ProductAsset|null>(null),children=ref<ProductAsset[]>([]),error=ref("");
watch(()=>props.productAssetId,async()=>{asset.value=null;children.value=[];error.value='';try{
  const request=async(id:string)=>{const response=await nodeApiRequest(`/api/product-assets/${encodeURIComponent(id)}`);const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Asset unavailable');return productAssetSchema.parse(body.asset);};
  asset.value=await request(props.productAssetId);
  if('children' in asset.value.document)children.value=await Promise.all(asset.value.document.children.map(child=>request(child.assetId)));
}catch(e){error.value=e instanceof Error?e.message:String(e);}},{immediate:true});
</script>
<template>
  <PersonalWorkspace v-if="asset?.document.kind==='page'" :product-asset-id="productAssetId"/>
  <section v-else class="product-page"><el-alert v-if="error" :title="error" type="error" :closable="false"/><template v-if="asset"><h1>{{asset.name}}</h1><p>{{asset.description}}</p><ManagerFrame><ProductAssetRuntime :asset="asset"/><section v-for="child in children" :key="child.id"><el-button v-if="child.document.kind==='page'" @click="router.push('/products/'+child.id)">{{child.name}}</el-button><ProductAssetRuntime v-else :asset="child"/></section></ManagerFrame></template></section>
</template>
<style scoped>.product-page{padding:24px;max-width:1280px;width:100%;box-sizing:border-box;margin:auto}.product-page section{margin:20px 0}</style>
