<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { useApplicationCatalog } from "../catalog";
import ApplicationRoute from "./ApplicationRoute.vue";
import PanelApplicationRoute from "./PanelApplicationRoute.vue";

const props = defineProps<{ applicationId: string; panelPath: string }>();
const { applicationById, ensureApplication } = useApplicationCatalog();
const application = computed(() => applicationById(props.applicationId));
const resolving = ref(false);
let epoch = 0;

watch(
  () => props.applicationId,
  (id) => {
    const current = ++epoch;
    resolving.value = true;
    void ensureApplication(id)
      .catch(() => undefined)
      .finally(() => {
        if (current === epoch) resolving.value = false;
      });
  },
  { immediate: true },
);
</script>

<template>
  <PanelApplicationRoute
    v-if="panelPath || (application && isPanelApplication(application))"
    :application-id="applicationId"
  />
  <ApplicationRoute v-else-if="application || !resolving" />
</template>
