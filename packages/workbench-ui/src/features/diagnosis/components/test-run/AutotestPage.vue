<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { diagnosisApi } from "../../api";
import type { AutotestRunMeta } from "../layout/types";
import TestPage from "./TestPage.vue";

/**
 * Remaining native autotest run page awaiting Batch 2 panel migration (`/ops/test`).
 * Test cases (`/ops/cases`), test results (`/ops/results`), and case artifacts (`/ops/autotest/case`) are served by
 * built-in panels inside the shared platform application frame.
 */
const runs = ref<AutotestRunMeta[]>([]);
const activeRunId = computed(
  () => runs.value.find((run) => run.status === "running" || run.status === "stopping")?.runId ?? null,
);

async function loadRuns() {
  try {
    runs.value = await diagnosisApi.listRuns();
  } catch (error) {
    runs.value = [];
    console.error("Failed to load autotest runs", error);
  }
}

onMounted(() => {
  void loadRuns();
});
</script>

<template>
  <div class="autotest-page">
    <div class="autotest-body">
      <TestPage :initial-run-id="activeRunId" @run-created="loadRuns()" @run-settled="loadRuns()" />
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
