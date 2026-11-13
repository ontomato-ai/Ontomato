<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import type {AppContext} from './context';
const props=defineProps<{
  /** The context returned by createAppContext. */
  context:AppContext;
  /** The existing product asset to render; manual edits remain visible on remount. */
  assetId:string;
  /** Change this value to reload the asset after editing it. */
  revision?:number;
}>();
const element=ref<HTMLElement>();
const error=ref('');
let dispose:(()=>void)|undefined;
watch(()=>[element.value,props.assetId,props.revision,props.context],()=>{
  dispose?.();dispose=undefined;error.value='';
  if(!element.value)return;
  try{dispose=props.context.mountProductAsset(element.value,props.assetId);}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}
},{flush:'post',immediate:true});
onBeforeUnmount(()=>dispose?.());
</script>
<template><div class="sdk-product-asset"><p v-if="error" role="alert">{{error}}</p><div ref="element" class="sdk-product-mount"/></div></template>
<style scoped>.sdk-product-asset,.sdk-product-mount{min-width:0;width:100%}.sdk-product-mount{min-height:160px}</style>
