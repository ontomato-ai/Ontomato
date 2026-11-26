<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { apiUrl,nodeApiRequest } from "@ontomato/workbench-ui";
import { useRoute } from "vue-router";
import { registerLiveFrame } from "../app-host";
const route = useRoute();
const src = computed(() => `${apiUrl("").replace(/\/api$/, "")}/apps/${encodeURIComponent(String(route.params.applicationId))}/`);
const frame=ref<HTMLIFrameElement|null>(null);
const policy=ref(false),error=ref('');
let generation=0;
watch(()=>String(route.params.applicationId),async id=>{const current=++generation;policy.value=false;error.value='';try{const response=await nodeApiRequest(`/api/workspaces/applications/${encodeURIComponent(id)}/policy`);const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Application policy unavailable');if(current===generation)policy.value=body.messageBridge===0;}catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}},{immediate:true});
let dispose:(()=>void)|undefined;
watch(frame,element=>{
  dispose?.();dispose=undefined;
  if(element) {
    dispose=registerLiveFrame(element.contentWindow!,String(route.params.applicationId));
    // Start navigation only after the empty frame has its explicit live binding.
    element.src=src.value;
  }
},{flush:"post"});
onBeforeUnmount(()=>{generation++;dispose?.();});
</script>
<template><p v-if="error" role="alert">{{error}}</p><iframe v-else-if="policy" ref="frame" :key="src" title="Application" class="connected-application" /></template>
<style scoped>
.connected-application { display: block; width: 100%; min-width: 0; min-height: 0; border: 0; flex: 1 1 0; }
</style>
