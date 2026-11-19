<script setup lang="ts">
import { computed } from "vue";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { useApplicationCatalog } from "../catalog";
import ApplicationRoute from "./ApplicationRoute.vue";
import PanelApplicationRoute from "./PanelApplicationRoute.vue";

const props = defineProps<{ applicationId: string; panelPath: string }>();
const { applications, loading } = useApplicationCatalog();
const application = computed(() => applications.value.find(app => app.id === props.applicationId));
</script>

<template>
  <PanelApplicationRoute
    v-if="panelPath || (application && isPanelApplication(application))"
    :application-id="applicationId"
  />
  <ApplicationRoute v-else-if="application || !loading" />
</template>
