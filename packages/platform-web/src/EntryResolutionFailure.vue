<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { entryResolutionFailureFor } from "./entry-resolution-failure";
import { usePlatformDataStateLabels } from "./data-state-labels";

const props = defineProps<{ failure?: { message: string; retry: () => void } }>();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const labels = usePlatformDataStateLabels();
const message = computed(() => props.failure?.message ?? entryResolutionFailureFor(route.path));

function retry() {
  if (props.failure) {
    props.failure.retry();
  } else {
    void router.replace({ path: route.path, query: route.query, hash: route.hash, force: true });
  }
}
</script>

<template>
  <section v-if="message !== null">
    <PlatformPageHeader :title="t('platform.entryReadFailed')" />
    <div class="platform-page-gutter">
      <DataState :result="{ status: 'error', message, retry }" :labels="labels" />
    </div>
  </section>
</template>
