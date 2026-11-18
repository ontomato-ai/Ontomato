<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PanelHost } from "@ontomato/platform-shell";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelUsesOf, platformPanelHost } from "../panel-host";

/**
 * One page of an application whose entry is `renderer:'panels'`: the panel that one of its use relations names, shown
 * full.
 *
 * The address is the application's own — `/applications/<application>/<the use relation's path>` — and the panel's
 * declared deep-linkable state rides in the same address as `state`, so a link or an agent's open request restores the
 * view, a reload opens the same one, and no credential ever appears there.
 *
 * The instance is the page's, keyed by the application and the use relation — not by the address — because the address
 * changes whenever the reader selects something: replacing the address must not rebuild the panel and lose that
 * selection.
 */
const props = defineProps<{
  /** The application whose panel this address shows. */
  applicationId: string;
  /** The rest of the address: the use relation's own path, without its leading slash. */
  panelPath?: string;
  /**
   * How the page beside the conversation carries its address. Shown beside a chat, the page is not the router's: the
   * conversation's own address holds it, and this writes a selection there. Shown full, the router's address is the page.
   */
  navigate?: (address: string) => void;
  /**
   * The page's address beside the conversation, as the conversation carries it, with the state the page opens at. Shown
   * full, the router's address is the page's.
   */
  address?: string;
}>();
const emit = defineEmits<{
  /** What the reader looks at in the panel, as its instance reports it: what a message written beside it carries. */
  context: [context: PageContext];
}>();

const route = useRoute();
const router = useRouter();
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

/** The page's address as the reader sees it: the application's, then this relation's own path. */
const address = computed(() => `/applications/${encodeURIComponent(props.applicationId)}${props.panelPath ? `/${props.panelPath}` : ""}`);

/** The instance: this page's, for as long as the application and the use relation are the same. */
const key = computed(() => `${props.applicationId}:${use.value?.id ?? ""}`);

/**
 * A selection the panel reports is the page's address: it is replaced in place, so the address bar and a reload carry
 * the same view, and the instance — which the key keeps — is not rebuilt.
 */
function writeAddress(next: string) {
  if (props.navigate) {
    props.navigate(next);
    return;
  }
  if (route.fullPath === next) return;
  void router.replace(next);
}

/**
 * The state the page was opened at. It is read once, when this instance starts, and kept: a selection the reader makes
 * afterwards is written into the address, and that write must not become the next instance's opening state.
 */
const initial = ref(panelAddressState(props.address ?? route.fullPath));
</script>

<template>
  <p v-if="failure" role="alert">{{ failure }}</p>
  <p v-else-if="!use" role="alert">{{ panelPath ?? "" }} is not a panel of this application</p>
  <PanelHost
    v-else
    :key="key"
    :port="port"
    :use-id="use.id"
    :address="address"
    :initial="initial"
    @address="writeAddress"
    @context="emit('context', $event)"
  />
</template>
