<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { diagnosisApi } from "../../api";
import type { AutotestRunMeta } from "../layout/types";
import TestcasesPage from "../testcases/TestcasesPage.vue";
import TestPage from "./TestPage.vue";

/**
 * Remaining native autotest pages awaiting Batch 2 panel migration (`/ops/test` and `/ops/cases`).
 * Test results (`/ops/results`) and case artifacts (`/ops/autotest/case`) are served by built-in panels inside the
 * shared platform application frame.
 */
const route = useRoute();
const runs = ref<AutotestRunMeta[]>([]);
const activeRunId = computed(
  () => runs.value.find((run) => run.status === "running" || run.status === "stopping")?.runId ?? null,
);
const showCases = computed(() => route.path === "/ops/cases");

async function loadRuns() {
  try {
    runs.value = await diagnosisApi.listRuns();
  } catch (error) {
    runs.value = [];
    console.error("Failed to load autotest runs", error);
  }
}

onMounted(() => {
  if (!showCases.value) void loadRuns();
});
</script>

<template>
  <div class="autotest-page">
    <div class="autotest-body">
      <TestcasesPage v-if="showCases" />
      <TestPage v-else :initial-run-id="activeRunId" @run-created="loadRuns()" @run-settled="loadRuns()" />
    </div>
  </div>
</template>

<style scoped>
.autotest-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.autotest-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
