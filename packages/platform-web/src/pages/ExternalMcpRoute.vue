<script setup lang="ts">
import { usePlatformHost } from "@ontomato/platform-admin";
import { ExternalMcpServices } from "@ontomato/workbench-ui/features/workbench";

/** The external MCP services in the system settings; which agents use each is shown to whoever may read the agents. */
const host = usePlatformHost();
</script>

<template>
  <ExternalMcpServices :show-usage="host.access.can('analysis-agent')" />
</template>
