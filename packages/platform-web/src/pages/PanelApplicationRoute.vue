<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, panelUnavailable, useUnsavedChanges, type PanelHostLabels, type PanelHostPort } from "@ontomato/platform-shell";
import { panelAddress, panelAddressState, panelUsePath, type PanelRefreshPort } from "@ontomato/contracts/panel-host";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import type { DisplayObjectRefresh } from "@ontomato/agent-shell-ui";
import type { PageContext } from "@ontomato/contracts/page-context";
import { panelUsesOf, platformPanelHost, type PanelObjectChange } from "../panel-host";

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
 *
 * Going from one of the application's pages to another keeps the page left, up to `KEPT_PAGES`: back on it, the reader
 * finds its frame as it was, with no frame rebuilt and no SDK loaded again, while its definition and objects are checked
 * behind it. A kept page holds no stream and reports nothing. Leaving the application drops them all.
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
/** The shown page's instance, which the conversation's object signal reaches; kept pages are reconciled when shown again. */
const host = ref<PanelRefreshPort | null>(null);
/** A change to objects the page shows, from the conversation or from a receipt for an operation in the shown frame. */
function changed(change: PanelObjectChange) {
  host.value?.refresh(change.target);
}
watch(() => props.objectRefresh?.seq, () => {
  if (props.objectRefresh) changed(props.objectRefresh);
}, { flush: "post" });

/**
 * How many of the application's pages keep their instance at once (design 7.2.1): the one shown and the one the reader
 * left last, which covers going back and forth between two pages of one application. Only a page left with nothing
 * unsaved is kept; a page left with unsaved changes is left through the platform's unsaved-changes question, and its
 * changes go with it. It is the prototype's number until the memory each kept frame holds has been measured
 * (`notes/keepalive.md`).
 */
const KEPT_PAGES = 2;

/** A page of this application whose instance is kept, shown or not. */
interface KeptPage {
  use: ApplicationPanelUse;
  port: PanelHostPort;
  /** The instance's own address, with its state, as it last reported it: where it is shown again from its bare address. */
  reported: string;
  context: PageContext | null;
  /** Whether it holds unsaved changes; only the shown page can, and leaving it so drops it. */
  dirty: boolean;
  /** When the reader was last on it, in the order of the pages shown: the page dropped is the one left longest ago. */
  lastShown: number;
}
/**
 * The kept pages, in the order they were opened. The order never changes while a page is kept: a frame moved in the
 * document is loaded again, which is the rebuild keeping it avoids.
 */
const kept = ref<KeptPage[]>([]);
let showings = 0;
const failure = ref("");

/** Reads the application's use relations, or says why it could not; `current` tells whether the answer is still wanted. */
async function readUses(applicationId: string, current: () => boolean) {
  try {
    const records = await panelUsesOf(applicationId);
    if (current()) uses.value = records;
  } catch (reason) {
    if (!current()) return;
    failure.value = reason instanceof Error ? reason.message : String(reason);
    emit("display-loaded", panelUnavailable(reason));
  }
}

// Another application is another set of pages: the kept ones of the application left are dropped.
watch(() => props.applicationId, (applicationId, _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  uses.value = null;
  kept.value = [];
  failure.value = "";
  emit("display-loaded", { status: "loading" });
  void readUses(applicationId, () => current);
}, { immediate: true });

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);
const openedPath = computed(() => opened.value.split("?")[0]!);

/** The use relation whose full path an address is, or the application's first when the address is the application's own. */
function useAt(path: string): ApplicationPanelUse | null {
  if (path === applicationRootPath(props.applicationId)) return uses.value?.[0] ?? null;
  return uses.value?.find((candidate) => panelUsePath(candidate.path) === path) ?? null;
}
const use = computed(() => useAt(openedPath.value));
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
const pageAddress = computed(() => {
  const search = opened.value.split("?")[1];
  const path = use.value ? panelUsePath(use.value.path) : "";
  return panelAddress(search ? `${path}?${search}` : path, {});
});

/** The display owns a paired page's address. A standalone route reflects the same state in place. */
function reportAddress(input: DisplayPageAddressInput) {
  const page = shownPage.value!;
  page.reported = input.address;
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

const shownPage = computed(() => kept.value.find((page) => page.use.id === use.value?.id) ?? null);

/**
 * The page the reader opens becomes the shown one: a kept page as it was left, or a new instance. At `KEPT_PAGES`, the
 * page with nothing unsaved that the reader left longest ago is dropped to make room.
 *
 * The page the reader opened is known before its frame has loaded: its name and address go to the conversation at once,
 * with no selection, since the panel has not said what it shows yet. What the frame reports later adds that; a kept page
 * says what it showed when it was left.
 */
watch(use, (next, previous) => {
  // A page left with unsaved changes was left through the unsaved-changes question: its changes go with its instance.
  const left = previous && previous.id !== next?.id ? kept.value.find((page) => page.use.id === previous.id) : undefined;
  if (left?.dirty) kept.value = kept.value.filter((page) => page !== left);
  if (!next) return;
  performance.mark("ontomato:panel-page-opened", { detail: { applicationId: props.applicationId, useId: next.id } });
  const found = kept.value.find((page) => page.use.id === next.id);
  if (found) found.lastShown = ++showings;
  else if (kept.value.length >= KEPT_PAGES) {
    const [oldest] = [...kept.value].sort((one, other) => one.lastShown - other.lastShown);
    kept.value = kept.value.filter((page) => page !== oldest);
  }
  const page = found ?? {
    use: next,
    port: markRaw(platformPanelHost(props.applicationId, next, changed)),
    reported: panelAddress(pageAddress.value, requestedState.value),
    context: null,
    dirty: false,
    lastShown: ++showings,
  };
  if (!found) kept.value = [...kept.value, page];
  // Its bare address opens a kept page as it was left: the address takes the state the page is at.
  if (found && !opened.value.includes("?")) reportAddress({ kind: "state", address: found.reported });
  emit("context", page.context ?? { url: page.reported, label: pageName.value, selection: [] });
}, { immediate: true });

// Leaving the shown page with unsaved changes asks the platform's question first. Beside a conversation the display
// controller asks instead, from the page's dirty report.
if (!props.navigate)
  useUnsavedChanges({ dirty: () => shownPage.value?.dirty ?? false, paths: () => use.value ? [panelUsePath(use.value.path)] : [] });

/** When a kept page shown again may ask for its objects again: the first of the two points its switch is measured at. */
function markReopened(page: KeptPage) {
  performance.mark("ontomato:panel-page-reopened", { detail: { applicationId: props.applicationId, useId: page.use.id } });
}

/** A kept page shown again whose use relation was withdrawn or bound elsewhere ends; the page opens from the current relations. */
function withdraw(page: KeptPage) {
  kept.value = kept.value.filter((other) => other !== page);
  void readUses(props.applicationId, () => true);
}

/**
 * The address and state each instance is given: the shown page follows the address the reader opened, unless that is its
 * bare address, which shows it as it was left; a kept page keeps its own, so nothing about another page reaches it.
 */
function addressOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? pageAddress.value : panelAddress(page.reported, {});
}
function stateOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? requestedState.value : panelAddressState(page.reported);
}

function reportContext(page: KeptPage, context: PageContext) {
  page.context = { ...context, label: pageName.value || context.label };
  if (page === shownPage.value) emit("context", page.context);
}

function reportDirty(page: KeptPage, dirty: boolean) {
  page.dirty = dirty;
  if (page === shownPage.value) emit("display-dirty", dirty);
}
</script>

<template>
  <p v-if="failure" role="alert">{{ failure }}</p>
  <p v-else-if="missing" role="alert">{{ missing }}</p>
  <template v-if="!failure">
    <PanelHost
      v-for="page in kept"
      v-show="page === shownPage"
      :key="page.use.id"
      :ref="(instance) => { if (page === shownPage) host = instance as PanelRefreshPort | null; }"
      :port="page.port"
      :labels="labels"
      :shown="page === shownPage"
      :address="addressOf(page)"
      :initial="stateOf(page)"
      @display-address="(input: DisplayPageAddressInput) => page === shownPage && reportAddress(input)"
      @display-loaded="(load: DisplayLoad) => page === shownPage && emit('display-loaded', load)"
      @display-dirty="(dirty: boolean) => reportDirty(page, dirty)"
      @context="(context: PageContext) => reportContext(page, context)"
      @reopened="markReopened(page)"
      @withdrawn="withdraw(page)"
    />
  </template>
</template>
