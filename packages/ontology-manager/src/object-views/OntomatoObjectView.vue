<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue";
import { ElConfigProvider, ID_INJECTION_KEY, useGetDerivedNamespace } from "element-plus";
import type { ObjectReference, ObjectViewActionEvent, ObjectViewEmbed } from "@ontomato/contracts/object-views";
import type { ManagerHostContext } from "../context";
import { hostSource, type ManagerAuthFailureStatus } from "../api";
import { nextElementIdPrefix } from "../instance-id";
import ObjectViewEmbedContent from "./ObjectViewEmbedContent.vue";
import "../theme.css";
import "../style.css";

const props = defineProps<{ context: ManagerHostContext; declaration: ObjectViewEmbed }>();
const emit = defineEmits<{
  "auth-failure": [status: ManagerAuthFailureStatus];
  "open-object": [reference: ObjectReference];
  "action-completed": [event: ObjectViewActionEvent];
  loaded: [event: { revision: number; reference: ObjectReference }];
  error: [message: string];
}>();
const prefix = nextElementIdPrefix();
provide(ID_INJECTION_KEY, { prefix, current: 0 });
const namespace = useGetDerivedNamespace();
const mounted = ref(false);
onMounted(() => mounted.value = true);
const identity = computed(() => hostSource(props.context));
const content = ref<InstanceType<typeof ObjectViewEmbedContent>>();
defineExpose({ reload: () => content.value?.reload() });
</script>
<template>
  <el-config-provider :locale="context.messages.element">
    <div :class="['ontology-manager', 'ontomato-object-view', { 'is-dark': context.theme === 'dark' }]" :style="context.presentation.themeProperties[context.theme]" :lang="context.locale" :dir="context.locale === 'ar' ? 'rtl' : 'ltr'">
      <div :id="`${namespace}-popper-container-${prefix}`" />
      <ObjectViewEmbedContent v-if="mounted && context.credential" :key="identity" ref="content" :context="context" :declaration="declaration" @auth-failure="emit('auth-failure', $event)" @open-object="emit('open-object', $event)" @action-completed="emit('action-completed', $event)" @loaded="emit('loaded', $event)" @error="emit('error', $event)" />
    </div>
  </el-config-provider>
</template>
<style scoped>
.ontomato-object-view { min-width: 0; padding: var(--spacing-lg); contain: layout; box-sizing: border-box; }
</style>
