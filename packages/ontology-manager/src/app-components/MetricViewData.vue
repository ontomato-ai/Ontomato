<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { metricViewsKey } from "../clients/metric-views";
import type { MetricViewDataSlots } from "./types";

/**
 * Binds one published MetricView by property and hands its result to the default slot, where the page puts a table, a
 * chart or a figure. It draws nothing of its own: the loading state and a failed read reach the slot as values.
 */
const props = withDefaults(
  defineProps<{
    /** The published MetricView to read. */
    metricViewId: string;
    /** Merged over the MetricView's own parameter defaults; reading again when the values change. */
    parameters?: Record<string, unknown>;
    /** Fixed-value text interpreted by Java using the current parameter definitions. */
    parameterTexts?: Record<string, string>;
  }>(),
  { parameters: () => ({}), parameterTexts: () => ({}) },
);

defineSlots<MetricViewDataSlots>();

const client = inject(metricViewsKey);
if (!client) throw new Error("MetricViewData must be mounted in a page that provides the MetricView client");

const data = ref<unknown>();
const loading = ref(false);
const error = ref<Error | null>(null);
let latest = 0;

const reload = async () => {
  const request = ++latest;
  loading.value = true;
  error.value = null;
  try {
    const result = await client.read({ id: props.metricViewId, parameters: props.parameters, parameterTexts: props.parameterTexts });
    if (request === latest) data.value = result;
  } catch (reason) {
    if (request === latest) error.value = reason as Error;
  } finally {
    if (request === latest) loading.value = false;
  }
};

watch(() => JSON.stringify([props.metricViewId, props.parameters, props.parameterTexts]), () => reload(), { immediate: true });
</script>

<template>
  <slot :data="data" :loading="loading" :error="error" :reload="reload" />
</template>
