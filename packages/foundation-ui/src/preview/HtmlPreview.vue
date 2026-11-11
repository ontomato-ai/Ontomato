<script setup lang="ts">
/**
 * A whole HTML document in a frame. How the document may run is the showing page's to state: its sandbox, and the
 * referrer policy of its requests (the browser's default when not given). Size and frame come from the page's styles.
 */
import { ref, watch, onBeforeUnmount } from "vue";
const props=defineProps<{
  /** The whole HTML document to show. */
  html: string;
  /** The frame's sandbox tokens, such as `allow-scripts`; an empty string lets nothing in the document run. */
  sandbox: string;
  /** The referrer policy of the document's requests. */
  referrerpolicy?: ReferrerPolicy;
  /** The frame's accessible name. */
  title?: string;
  /** The showing host registers this browsing context before the document can run. */
  registerFrame?: (source: object) => (() => void) | undefined;
}>();
const frame=ref<HTMLIFrameElement|null>(null);
const registered=ref(false);
let dispose:(()=>void)|undefined;
watch(frame,element=>{
  dispose?.();dispose=undefined;registered.value=false;
  if(element && props.registerFrame) {
    dispose=props.registerFrame(element.contentWindow!);
    registered.value=true;
  }
},{flush:"post"});
onBeforeUnmount(()=>dispose?.());
</script>

<template>
  <iframe ref="frame" class="html-preview" :srcdoc="registerFrame && !registered ? undefined : html" :sandbox="sandbox" :referrerpolicy="referrerpolicy" :title="title" />
</template>

<style scoped>
/* A bare frame by default; any style of the showing page wins. */
:where(.html-preview) {
  display: block;
  width: 100%;
  border: 0;
}
</style>
