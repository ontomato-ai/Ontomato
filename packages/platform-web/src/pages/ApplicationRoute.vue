<script setup lang="ts">
import { computed } from "vue";
import { apiUrl } from "@ontomato/workbench-ui";
import { useRoute } from "vue-router";
const route = useRoute();
const src = computed(() => `${apiUrl("").replace(/\/api$/, "")}/apps/${encodeURIComponent(String(route.params.applicationId))}/`);
</script>
<template><iframe :key="src" :src="src" title="Application" class="hosted-application" /></template>
<style scoped>.hosted-application { width: 100%; height: 100%; border: 0; flex: 1; }</style>
