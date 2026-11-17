<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { PanelHost } from "@ontomato/platform-shell";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { panelUsesOf, platformPanelHost } from "../panel-host";

/**
 * One page of an application whose entry is `renderer:'panels'`: the panel that one of its use relations names, shown
 * full.
 *
 * The address is the application's own — `/applications/<application>/<the use relation's path>` — and the panel's
 * declared deep-linkable state rides in the same address, so a link or an agent's open request restores the view and
 * never carries a credential. Reading the relations is this page's only call: the panel, its projections and everything
 * they show are read under the reader's own credential, by the host and by the frame the panel runs in.
 */
const props = defineProps<{
  /** The application whose panel this address shows. */
  applicationId: string;
  /** The rest of the address: the use relation's own path, without its leading slash. */
  panelPath?: string;
}>();

const route = useRoute();
const uses = ref<readonly ApplicationPanelUse[]>([]);
const failure = ref("");
const port = platformPanelHost(props.applicationId);

async function read() {
  try {
    uses.value = await panelUsesOf(props.applicationId);
    failure.value = "";
  } catch (reason) {
    failure.value = reason instanceof Error ? reason.message : String(reason);
  }
}
void read();
watch(() => props.applicationId, () => void read());

/** The use relation this address names, or the application's first when the address is the application's own. */
const use = computed<ApplicationPanelUse | null>(() => {
  const path = props.panelPath ? `/${props.panelPath}`.replace(/\/+$/, "") : "";
  if (!path) return uses.value[0] ?? null;
  return uses.value.find((candidate) => candidate.path.replace(/\/+$/, "") === path) ?? null;
});

/**
 * The instance: it is the page's, so another address opens another instance with the state that address carries, and
 * leaving the page ends it. Two addresses of one panel are two instances, which is what keeps one reader's choice apart
 * from another's.
 */
const key = computed(() => route.fullPath);
/** The page's address as the reader sees it: the application's, then this relation's own path. */
const address = computed(() => `/applications/${encodeURIComponent(props.applicationId)}${props.panelPath ? `/${props.panelPath}` : ""}`);
</script>

<template>
  <p v-if="failure" role="alert">{{ failure }}</p>
  <p v-else-if="!use" role="alert">{{ panelPath ?? "" }} is not a panel of this application</p>
  <PanelHost v-else :key="key" :port="port" :use-id="use.id" :label="use.pageKey" :address="address" />
</template>
