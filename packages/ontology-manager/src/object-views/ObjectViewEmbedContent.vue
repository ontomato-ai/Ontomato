<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowReactive, watch } from "vue";
import { ElAlert, ElSkeleton } from "element-plus";
import { objectViewDocumentSchema, objectViewEmbedSchema, resolveViewInputs, type ObjectReference, type ObjectViewActionEvent, type ObjectViewDocument, type ObjectViewEmbed } from "@ontomato/contracts/object-views";
import { provideManagerContext, type ManagerHostContext } from "../context";
import { ontologyText } from "../i18n";
import { viewInputErrorMessage } from "./input-error";
import { provideManagerFeedback } from "../feedback";
import type { ManagerAuthFailureStatus } from "../api";
import ObjectViewRuntime from "./ObjectViewRuntime.vue";

const props = defineProps<{ context: ManagerHostContext; declaration: ObjectViewEmbed }>();
const emit = defineEmits<{
  "auth-failure": [status: ManagerAuthFailureStatus];
  "open-object": [reference: ObjectReference];
  "action-completed": [event: ObjectViewActionEvent];
  loaded: [event: { revision: number; reference: ObjectReference }];
  error: [message: string];
}>();
const context = shallowReactive({ ...props.context });
watch(() => props.context, value => Object.assign(context, value), { flush: "sync" });
const client = provideManagerContext(context, status => emit("auth-failure", status));
const root = ref<HTMLElement>();
provideManagerFeedback(root);
const document = ref<ObjectViewDocument>();
const object = ref<Record<string, unknown>>({});
const reference = ref<ObjectReference>();
const localReference = ref<ObjectReference>();
const loading = ref(false);
const error = ref("");
const declaration = computed(() => {
  const parsed = objectViewEmbedSchema.safeParse(props.declaration);
  if (!parsed.success) throw new Error(ontologyText(context.messages, "ovInvalidDeclaration"));
  return parsed.data;
});
const suppliedInputs = computed(() => localReference.value && localReference.value.className !== declaration.value.view.className ? {} : declaration.value.inputs);
const inputs = computed(() => document.value ? resolveViewInputs(document.value, suppliedInputs.value) : {});
let request = 0;
onBeforeUnmount(() => request++);
function report(reason: unknown) {
  error.value = viewInputErrorMessage(reason, (key, params) => ontologyText(context.messages, key, params));
  emit("error", error.value);
}
async function load() {
  const current = ++request;
  loading.value = true;
  document.value = undefined;
  error.value = "";
  try {
    const config = declaration.value;
    const target = localReference.value || { className: config.view.className, primaryKey: config.object.primaryKey };
    const view = { ...config.view, className: target.className, revision: localReference.value ? "published" as const : config.view.revision };
    const [resolved, result] = await Promise.all([
      client.resolveObjectView(view.className, view.form, view.revision),
      client.queryInstanceInfo(`${target.className}:${target.primaryKey}`, target.className),
    ]);
    if (current !== request) return;
    const parsed = objectViewDocumentSchema.parse(resolved.document);
    resolveViewInputs(parsed, suppliedInputs.value);
    object.value = (result.data || {}) as Record<string, unknown>;
    reference.value = target;
    document.value = parsed;
    emit("loaded", { revision: resolved.revision, reference: { ...target } });
  } catch (reason) { if (current === request) report(reason); }
  finally { if (current === request) loading.value = false; }
}
async function refresh() {
  if (!reference.value) return;
  const current = ++request;
  const target = { ...reference.value };
  try {
    const result = await client.queryInstanceInfo(`${target.className}:${target.primaryKey}`, target.className);
    if (current === request) object.value = (result.data || {}) as Record<string, unknown>;
  } catch (reason) { if (current === request) report(reason); }
}
function open(target: ObjectReference) {
  emit("open-object", target);
  if (declaration.value.navigation === "local") { localReference.value = target; void load(); }
}
watch(() => JSON.stringify(props.declaration), () => { localReference.value = undefined; void load(); }, { immediate: true });
defineExpose({ reload: load });
</script>
<template>
  <div ref="root" class="object-view-embed-content" :aria-busy="loading">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="loading" :rows="6" animated />
    <ObjectViewRuntime v-else-if="document && reference" :document="document" :object="object" :reference="reference" :inputs="inputs" @open="open" @refresh="refresh" @action-completed="emit('action-completed', $event)" />
  </div>
</template>
