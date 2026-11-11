<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { apiUrl } from "@ontomato/workbench-ui";
import { useRoute } from "vue-router";
import { registerLiveFrame } from "../app-host";
const route = useRoute();
const src = computed(() => `${apiUrl("").replace(/\/api$/, "")}/apps/${encodeURIComponent(String(route.params.applicationId))}/`);
const frame=ref<HTMLIFrameElement|null>(null);
let dispose:(()=>void)|undefined;
watch(frame,element=>{
  dispose?.();dispose=undefined;
  if(element) {
    dispose=registerLiveFrame(element.contentWindow!);
    // Start navigation only after the empty frame has its explicit live binding.
    element.src=src.value;
  }
},{flush:"post"});
onBeforeUnmount(()=>dispose?.());
</script>
<template><iframe ref="frame" :key="src" title="Application" class="hosted-application" /></template>
<style scoped>.hosted-application { width: 100%; height: 100%; border: 0; flex: 1; }</style>
