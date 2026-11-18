<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, type PanelHostLabels } from "@ontomato/platform-shell";
import { panelAddress, panelAddressState, panelUsePath } from "@ontomato/contracts/panel-host";
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
const { t, locale } = useI18n();
/** The application's use relations, once Java has answered; until then the page names none and says nothing. */
const uses = ref<readonly ApplicationPanelUse[] | null>(null);
const failure = ref("");
const port = computed(() => platformPanelHost(props.applicationId));

watch(() => props.applicationId, async (applicationId, _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  uses.value = null;
  failure.value = "";
  try {
    const records = await panelUsesOf(applicationId);
    if (current) uses.value = records;
  } catch (reason) {
    if (current) failure.value = reason instanceof Error ? reason.message : String(reason);
  }
}, { immediate: true });

/** The use relation this address names, or the application's first when the address is the application's own. */
const use = computed<ApplicationPanelUse | null>(() => {
  const path = props.panelPath ? `/${props.panelPath}`.replace(/\/+$/, "") : "";
  if (!path) return uses.value?.[0] ?? null;
  return uses.value?.find((candidate) => candidate.path.replace(/\/+$/, "") === path) ?? null;
});

/** What the panel host says to the reader, in the platform's language. */
const labels = computed<PanelHostLabels>(() => ({
  useMissing: (useId) => t("platform.panelUseMissing", { use: useId }),
  notStarted: t("platform.panelNotStarted"),
  failures: {
    // The frame puts the file it could not load where `{file}` stands.
    fileUnavailable: t("platform.panelFileUnavailable", { file: "{file}" }),
    scriptThrew: t("platform.panelScriptThrew"),
    scriptRejected: t("platform.panelScriptRejected"),
  },
}));

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);

/**
 * The page's address without the panel's own state: the application's, this relation's own path, and the rest of the
 * address's query — a draft an agent wrote for this page names itself there (`draftSessionId`, `draftRunId`,
 * `draftPath`), and the panel reads it from the address it is given. The state is the instance's to add.
 */
const address = computed(() => {
  const search = opened.value.split("?")[1];
  const path = use.value ? panelUsePath(props.applicationId, use.value.path) : "";
  return panelAddress(search ? `${path}?${search}` : path, {});
});

/**
 * The instance: this page's, for as long as the application, the use relation and the rest of the address are the same.
 * The reader's selection changes only the state, so it keeps the instance; another draft is another instance, which
 * reads it.
 */
const key = computed(() => `${props.applicationId}:${use.value?.id ?? ""}`);

/**
 * A selection the panel reports is the page's address: it is replaced in place, so the address bar and a reload carry
 * the same view, and the instance — which the key keeps — is not rebuilt.
 */
function writeAddress(next: string) {
  if (opened.value === next) return;
  if (props.navigate) {
    props.navigate(next);
    return;
  }
  void router.replace(next);
}

const requestedState = computed(() => panelAddressState(opened.value));

/**
 * The page's name is the application's: its use relation's display name in the reader's language. A relation without
 * one is named by what its panel reports.
 */
const pageName = computed(() => use.value?.names?.[locale.value] ?? use.value?.names?.en ?? "");

/**
 * The page the reader opened is known before its frame has loaded: its name and address go to the conversation at once,
 * with no selection, since the panel has not said what it shows yet. What the frame reports later adds that.
 */
watch(use, (opened) => {
  if (opened) emit("context", { url: panelAddress(address.value, requestedState.value), label: pageName.value, selection: [] });
}, { immediate: true });

function reportContext(context: PageContext) {
  emit("context", { ...context, label: pageName.value || context.label });
}
</script>

<template>
  <p v-if="failure" role="alert">{{ failure }}</p>
  <p v-else-if="uses && !use" role="alert">{{ t("platform.panelNotInApplication", { path: `/${panelPath ?? ""}` }) }}</p>
  <PanelHost
    v-else-if="use"
    :key="key"
    :port="port"
    :labels="labels"
    :use-id="use.id"
    :address="address"
    :initial="requestedState"
    @address="writeAddress"
    @context="reportContext"
  />
</template>
