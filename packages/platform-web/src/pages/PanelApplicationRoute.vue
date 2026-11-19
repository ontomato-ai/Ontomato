<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, panelUnavailable, type PanelHostLabels } from "@ontomato/platform-shell";
import { panelAddress, panelAddressState, panelUsePath, type PanelRefreshPort } from "@ontomato/contracts/panel-host";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import type { DisplayObjectRefresh } from "@ontomato/agent-shell-ui";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelUsesOf, platformPanelHost } from "../panel-host";

/**
 * One page of an application whose entry is `renderer:'panels'`: the panel that one of its use relations names, shown
 * full.
 *
 * The address is the use relation's own full path, as Java declares it — `/applications/<application>/...` for a domain
 * application — and the panel's declared deep-linkable state rides in the same address as `state`, so a link or an
 * agent's open request restores the view, a reload opens the same one, and no credential ever appears there. The
 * application's root address opens its first use the reader may see.
 *
 * The instance is the page's, keyed by the application and the use relation — not by the address — because the address
 * changes whenever the reader selects something: replacing the address must not rebuild the panel and lose that
 * selection.
 */
const props = defineProps<{
  /** The application whose panel this address shows. */
  applicationId: string;
  /**
   * The conversation's callback for explicit navigation, supplied when the display controller owns this page.
   * A full-page instance uses the router for its address.
   */
  navigate?: (address: string) => void;
  /**
   * The page's address beside the conversation, as the conversation carries it, with the state the page opens at. Shown
   * full, the router's address is the page's.
   */
  address?: string;
  objectRefresh?: DisplayObjectRefresh | null;
}>();
const emit = defineEmits<{
  /** What the reader looks at in the panel, as its instance reports it: what a message written beside it carries. */
  context: [context: PageContext];
  "display-address": [input: DisplayPageAddressInput];
  "display-loaded": [load: DisplayLoad];
  "display-dirty": [dirty: boolean];
}>();

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
/** The application's use relations, once Java has answered; until then the page names none and says nothing. */
const uses = ref<readonly ApplicationPanelUse[] | null>(null);
const host = ref<PanelRefreshPort | null>(null);
watch(() => props.objectRefresh?.seq, () => {
  if (props.objectRefresh) host.value?.refresh(props.objectRefresh.target);
}, { flush: "post" });
const failure = ref("");

watch(() => props.applicationId, async (applicationId, _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  uses.value = null;
  failure.value = "";
  emit("display-loaded", { status: "loading" });
  try {
    const records = await panelUsesOf(applicationId);
    if (current) uses.value = records;
  } catch (reason) {
    if (!current) return;
    failure.value = reason instanceof Error ? reason.message : String(reason);
    emit("display-loaded", panelUnavailable(reason));
  }
}, { immediate: true });

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);
const openedPath = computed(() => opened.value.split("?")[0]!);

/** The use relation whose full path this address is, or the application's first when the address is the application's own. */
const use = computed<ApplicationPanelUse | null>(() => {
  if (openedPath.value === applicationRootPath(props.applicationId)) return uses.value?.[0] ?? null;
  return uses.value?.find((candidate) => panelUsePath(candidate.path) === openedPath.value) ?? null;
});
const port = computed(() => use.value && platformPanelHost(props.applicationId, use.value));
/** An address that names no use relation the reader may open is a page that cannot load, and its receipt says so. */
const missing = computed(() => uses.value && !use.value ? t("platform.panelNotInApplication", { path: openedPath.value }) : "");
watch(missing, (message) => {
  if (message) emit("display-loaded", panelUnavailable(new Error(message)));
});

/** What the panel host says to the reader, in the platform's language. */
const labels = computed<PanelHostLabels>(() => ({
  notStarted: t("platform.panelNotStarted"),
  failures: {
    // The frame puts the file it could not load where `{file}` stands.
    fileUnavailable: t("platform.panelFileUnavailable", { file: "{file}" }),
    scriptThrew: t("platform.panelScriptThrew"),
    scriptRejected: t("platform.panelScriptRejected"),
  },
}));

/**
 * The page's address without the panel's own state: this relation's own full path and the rest of the address's query — a draft an agent wrote for this page names itself there (`draftSessionId`, `draftRunId`,
 * `draftPath`), and the panel reads it from the address it is given. The state is the instance's to add.
 */
const address = computed(() => {
  const search = opened.value.split("?")[1];
  const path = use.value ? panelUsePath(use.value.path) : "";
  return panelAddress(search ? `${path}?${search}` : path, {});
});

/**
 * The instance: this page's, for as long as the application, the use relation and the rest of the address are the same.
 * The reader's selection changes only the state, so it keeps the instance; another draft is another instance, which
 * reads it.
 */
const key = computed(() => `${props.applicationId}:${use.value?.id ?? ""}`);

/** The display owns a paired page's address. A standalone route reflects the same state in place. */
function reportAddress(input: DisplayPageAddressInput) {
  if (props.navigate) {
    emit("display-address", input);
    return;
  }
  if (opened.value !== input.address) void router.replace(input.address);
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
  <p v-else-if="missing" role="alert">{{ missing }}</p>
  <PanelHost
    v-else-if="port"
    :key="key"
    ref="host"
    :port="port"
    :labels="labels"
    :address="address"
    :initial="requestedState"
    @display-address="reportAddress"
    @display-loaded="emit('display-loaded', $event)"
    @display-dirty="emit('display-dirty', $event)"
    @context="reportContext"
  />
</template>
