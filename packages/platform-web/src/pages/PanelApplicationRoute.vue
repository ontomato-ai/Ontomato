<script setup lang="ts">
import { computed, inject, markRaw, ref, shallowRef, toRaw, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, panelUnavailable, useApplicationTheme, useAppTheme, usePageHeading, useUnsavedChanges, type PanelHostLabels, type PanelHostPort, type PanelInstanceView } from "@ontomato/platform-shell";
import { applicationPanelAddress, panelAddress, panelAddressState, panelUsePath, parseApplicationPanelAddress } from "@ontomato/contracts/panel-host";
import type { PanelDeepLinkStateValue } from "@ontomato/contracts/panel-manifest";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import type { ApplicationEntryResolution, ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { PageComposer, type DisplayObjectRefresh } from "@ontomato/agent-shell-ui";
import { countedTypesChangedKey } from "@ontomato/ontology-manager";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import { platformPanelHost, resolveApplicationEntry, type PanelObjectChange } from "../panel-host";
import { hostThemeMode } from "../app-host";
import { useApplicationCatalog } from "../catalog";

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
  /** Which page skill a message written beside the shown page reaches, as Node answered it with the page's panel. */
  "display-skill": [context: PageSkillContext];
}>();

const route = useRoute();
const router = useRouter();
const { t, locale, fallbackLocale } = useI18n();
/** The language a panel's own name is given in: the reader's, else the deployment's default. */
const language = computed(() => ({ locale: locale.value, fallback: String(fallbackLocale.value) }));
/** The shown page's instance, which the conversation's object signal reaches; kept pages are reconciled when shown again. */
/** What the conversation's and an operation's changes reach: the shown page's instance. */
type ShownInstance = Pick<PanelInstanceView, "refresh">;
const host = ref<ShownInstance | null>(null);
/** The Manager's counts, where it is installed: told which object types a write changed, they decide whether to re-read. */
const countedTypesChanged = inject(countedTypesChangedKey, null);
/**
 * A change to objects the page shows, from the conversation or from a receipt for an operation in the shown frame: the
 * one place either is taken in. The shown instance re-reads what it displays of the target, and the counts hear of the
 * object types the write changed.
 */
function changed(change: PanelObjectChange) {
  host.value?.refresh(change.target, change.affected);
  if (change.affected) countedTypesChanged?.(change.affected.objectTypes);
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
  /** Which page skill a message beside it reaches, as its instance's latest read for it answered; null until one has. */
  pageSkill: PageSkillContext | null;
  /** Shown again and not yet through its checks: what it reaches is passed on only once they have confirmed it. */
  rechecking: boolean;
  /** When the reader was last on it, in the order of the pages shown: the page dropped is the one left longest ago. */
  lastShown: number;
}
/**
 * The kept pages, in the order they were opened. The order never changes while a page is kept: a frame moved in the
 * document is loaded again, which is the rebuild keeping it avoids.
 */
// Typed as the pages themselves: unwrapping each page's port and contexts as reactive state is too deep to type.
const kept = ref([]) as Ref<KeptPage[]>;
let showings = 0;
const failure = ref("");
const catalog = useApplicationCatalog();
/**
 * Java's answer for the entry the reader opened (\`resolve-entry\`): its use relation, admitted for this reader, with the
 * application's frame panel and theme where its renderer is \`panels\`, and the menu of the entries the reader may see. The
 * page starts from the shell's catalog while it is read, and shows nothing until it names the same page (the host's
 * \`admitted\`); the opened page's admission and the route share this one read.
 */
const resolution = shallowRef<ApplicationEntryResolution | null>(null);
let resolving: Promise<ApplicationEntryResolution> | null = null;
/** Whether \`resolution\` is Java's answer for the address opened now. */
const answered = ref(false);
/** Read again after a kept page's use relation was withdrawn. */
const rereads = ref(0);

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);
const openedPath = computed(() => opened.value.split("?")[0]!);
/** The reader's use relations as the shell's catalog lists them: where a page starts before Java answers. */
const listed = computed(() => catalog.applications.value.find((app) => app.id === props.applicationId)?.panelUses ?? []);
/** The entry an address opens: its own path, or the application's first listed entry at the application's own address. */
const entryPath = computed(() => {
  if (openedPath.value !== applicationRootPath(props.applicationId)) return openedPath.value;
  const first = resolution.value?.menu.panelUses[0] ?? listed.value[0];
  return first ? panelUsePath(first.path) : null;
});

// Another application is another set of pages: the kept ones of the application left are dropped.
watch(() => props.applicationId, () => {
  kept.value = [];
  failure.value = "";
  emit("display-loaded", { status: "loading" });
}, { immediate: true });

watch([() => props.applicationId, entryPath, rereads], ([applicationId, path], _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  answered.value = false;
  if (!path) {
    resolution.value = null;
    answered.value = true;
    return;
  }
  const read = resolving = resolveApplicationEntry({ path });
  read.then((answer) => {
    if (!current) return;
    // An answer for another application is not this route's page.
    resolution.value = answer.applicationId === applicationId ? answer : null;
    answered.value = true;
  }, () => {
    // Java finds no entry the reader may open at this address: the page says so in the platform's language.
    if (!current) return;
    resolution.value = null;
    answered.value = true;
  });
}, { immediate: true });

/**
 * The use relation the opened address names: Java's, once it answered. Until then, a kept page's own relation — shown
 * again at once, and checked again before it may ask for anything — else the catalog's, unadmitted.
 */
const use = computed<ApplicationPanelUse | null>(() => {
  const path = entryPath.value;
  if (!path) return null;
  if (answered.value) return resolution.value && panelUsePath(resolution.value.use.path) === path ? resolution.value.use : null;
  const at = (candidate: ApplicationPanelUse) => panelUsePath(candidate.path) === path;
  return kept.value.find((page) => at(page.use))?.use ?? listed.value.find(at) ?? null;
});
/**
 * The application's theme from Java's answer (a \`panels\` application's only). At full page the platform's layout assigns
 * it on the application's area, its menu and its page; beside a conversation it is assigned on this content alone.
 */
const area = ref<HTMLElement | null>(null);
if (props.navigate) useAppTheme(area, () => resolution.value?.theme, hostThemeMode);
else useApplicationTheme(() => resolution.value?.theme);
/** An address that names no use relation the reader may open is a page that cannot load, and its receipt says so. */
const missing = computed(() => answered.value && !use.value ? t("platform.panelNotInApplication", { path: openedPath.value }) : "");
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
  content: { styleOutside: t("platform.panelStyleOutside") },
  refresh: t("common.refresh"),
}));

/**
 * The composer at the foot of the page at its own address (big main's ruling, 2026-11-21): what a message written here
 * asks about is the page above it, and a conversation entry in the panel expands it. Beside a conversation the
 * conversation's own composer serves instead. Its configuration error is shown where it would be.
 */
const composerProblem = ref<string | null>(null);
/** The page skill a message written on the shown page reaches, once its read or its checks have said which. */
const shownSkill = ref<PageSkillContext | null>(null);
/** The shown page's skill is known: a message beside it, and the page's own composer, reach it. */
function passSkill(context: PageSkillContext) {
  shownSkill.value = context;
  emit("display-skill", context);
}
const composerLabels = computed(() => ({
  placeholder: t("assistant.placeholder"),
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  agent: t("assistant.agent"),
  pageAgentUnavailable: t("assistant.pageAgentUnavailable"),
  collapseComposer: t("assistant.collapseComposer"),
  expandComposer: t("assistant.expandComposer"),
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
  const address = withoutEntryInputs(input.address, page.use);
  page.reported = address;
  if (props.navigate) {
    emit("display-address", { ...input, address });
    return;
  }
  if (opened.value !== address) void router.replace(address);
}

/**
 * The values an entry passes its content panel (product-layer standard, part three): a field the entry wires is the
 * entry's, so the panel takes the passed value whatever the address or the reader's saved state says, and the address
 * does not carry it. Only fixed values (\`literal\`) are passed for now: a value from a frame's state comes with frames.
 */
function entryInputs(use: ApplicationPanelUse): Record<string, PanelDeepLinkStateValue> {
  return Object.fromEntries(Object.entries(use.inputs ?? {}).flatMap(([field, input]) =>
    "literal" in input ? [[field, input.literal as PanelDeepLinkStateValue]] : []));
}
/** An address without the state fields the entry wires: those are the entry's to give, not the address's. */
function withoutEntryInputs(address: string, use: ApplicationPanelUse) {
  const wired = Object.keys(use.inputs ?? {});
  if (!wired.length || !address.includes("?")) return address;
  const { path, frame, state, query } = parseApplicationPanelAddress(address);
  for (const field of wired) delete state[field];
  return applicationPanelAddress(path, { frame, state, query });
}

const requestedState = computed(() => panelAddressState(opened.value));

/**
 * The page's name is the application's: its use relation's display name in the reader's language. A relation without
 * one is named by what its panel reports.
 */
const pageName = computed(() => use.value?.names?.[locale.value] ?? use.value?.names?.en ?? "");
/** The line under the page's title, as a native page's header has it: the entry's description in the reader's language. */
const pageDescription = computed(() => use.value?.descriptions?.[locale.value] ?? use.value?.descriptions?.en);

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
  // Java's answer naming the page the catalog opened is the same page; one it rebinds ends that page's check.
  if (next && previous?.id === next.id && previous.panelId === next.panelId) return;
  // A page left with unsaved changes was left through the unsaved-changes question: its changes go with its instance.
  const left = previous && previous.id !== next?.id ? kept.value.find((page) => page.use.id === previous.id) : undefined;
  if (left?.dirty) kept.value = kept.value.filter((page) => page !== left);
  shownSkill.value = null;
  if (!next) return;
  performance.mark("ontomato:panel-page-opened", { detail: { applicationId: props.applicationId, useId: next.id } });
  const found = kept.value.find((page) => page.use.id === next.id);
  if (found) found.lastShown = ++showings;
  else if (kept.value.length >= KEPT_PAGES) {
    const [oldest] = [...kept.value].sort((one, other) => one.lastShown - other.lastShown);
    kept.value = kept.value.filter((page) => page !== oldest);
  }
  const page = found ?? openPage(next);
  if (!found) kept.value = [...kept.value, page];
  // A kept page shown again is checked again, and its page skill with it; a new page tells it once its panel is read.
  if (found) found.rechecking = true;
  // Its bare address opens a kept page as it was left: the address takes the state the page is at.
  if (found && !opened.value.includes("?")) reportAddress({ kind: "state", address: found.reported });
  emit("context", page.context ?? { url: page.reported, label: pageName.value, selection: [] });
}, { immediate: true });

/*
 * The shown page sent to its bare address — its menu row clicked while it is open, or the address typed without a state —
 * opens it at its panel's defaults, as a native page goes back to its start: only a page shown again from another keeps
 * the state it was left at. A page with unsaved changes is not reset under them: the address goes back to its state.
 */
watch([() => use.value?.id, opened], ([id, next], [previousId, previous]) => {
  const page = shownPage.value;
  if (!id || id !== previousId || next === previous || next.includes("?") || !page) return;
  if (page.dirty) reportAddress({ kind: "state", address: page.reported });
  else page.reported = pageAddress.value;
});

// Leaving the shown page with unsaved changes asks the platform's question first. Beside a conversation the display
// controller asks instead, from the page's dirty report.
if (!props.navigate)
  useUnsavedChanges({ dirty: () => shownPage.value?.dirty ?? false, paths: () => use.value ? [panelUsePath(use.value.path)] : [] });

/**
 * The page's title, description and way back at its own address (big main's rulings, 2026-11-21): the panel draws none
 * of them, and the description is the entry's own, under the title as on a native page. The title is
 * what a message names the page by — the entry's menu name, else its panel's own name — so the two never differ; a page
 * the application's menu does not reach (an entry with no menu name) also gets the way back to where the reader came
 * from, or to the application's root when the page was opened directly. Beside a conversation, the conversation draws both.
 */
if (!props.navigate) {
  usePageHeading(() => {
    const title = shownPage.value?.context?.label || pageName.value;
    if (!title) return null;
    const description = pageDescription.value;
    return { title, ...description ? { description } : {}, ...use.value?.names ? {} : { back: goBack } };
  });
}
function goBack() {
  if (typeof router.options.history.state.back === "string") router.back();
  else void router.push(applicationRootPath(props.applicationId));
}

/** When a kept page shown again may ask for its objects again: the first of the two points its switch is measured at. */
function markReopened(page: KeptPage) {
  performance.mark("ontomato:panel-page-reopened", { detail: { applicationId: props.applicationId, useId: page.use.id } });
  // Its checks are through: the page skill they confirmed is the one a message beside it reaches now.
  page.rechecking = false;
  passSkill(page.pageSkill!);
}

/** A new instance for a page of this application. */
function openPage(use: ApplicationPanelUse): KeptPage {
  const page: KeptPage = {
    use,
    port: undefined!,
    reported: panelAddress(pageAddress.value, requestedState.value),
    context: null,
    dirty: false,
    pageSkill: null,
    rechecking: false,
    lastShown: ++showings,
  };
  page.port = markRaw(platformPanelHost(
    props.applicationId, use, changed, undefined, answered.value ? undefined : resolving ?? undefined, (context) => reportPageSkill(page, context),
    // Beside a conversation, an address the panel opens goes to the conversation's display; at full page, the router.
    props.navigate,
  ));
  return page;
}

/**
 * The page skill an instance's read answered: kept with the instance, and passed on when it changed, only while that
 * same instance is the shown page and not in the middle of being checked again — an answer that arrives after the reader
 * moved on, or for an instance since dropped, stays its own. A page shown again passes on what its checks confirmed.
 */
function reportPageSkill(page: KeptPage, context: PageSkillContext) {
  const changed = JSON.stringify(context) !== JSON.stringify(page.pageSkill);
  page.pageSkill = context;
  if (changed && shownPage.value && toRaw(shownPage.value) === page && !page.rechecking) passSkill(context);
}

/** A kept page shown again whose use relation was withdrawn or bound elsewhere ends; the page opens from the current relations. */
function withdraw(page: KeptPage) {
  kept.value = kept.value.filter((other) => other !== page);
  rereads.value += 1;
}

/**
 * The address and state each instance is given: the shown page follows the address the reader opened, unless that is its
 * bare address, which shows it as it was left; a kept page keeps its own, so nothing about another page reaches it.
 */
function addressOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? pageAddress.value : panelAddress(page.reported, {});
}
function stateOf(page: KeptPage) {
  const state = page === shownPage.value && opened.value.includes("?") ? requestedState.value : panelAddressState(page.reported);
  return { ...state, ...entryInputs(page.use) };
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
  <div ref="area" class="panel-application-area">
  <p v-if="failure" role="alert">{{ failure }}</p>
  <p v-else-if="missing" role="alert">{{ missing }}</p>
  <template v-if="!failure">
    <PanelHost
      v-for="page in kept"
      v-show="page === shownPage"
      :key="page.use.id"
      :class="{ 'panel-host-page': !props.navigate }"
      :ref="(instance) => { if (page === shownPage) host = instance as ShownInstance | null; }"
      :port="page.port"
      :labels="labels"
      :language="language"
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
    <!-- Offered once the panel's read named the page's skill: the agents are the ones that skill reaches. -->
    <PageComposer
      v-if="!props.navigate && shownPage && shownSkill"
      :page="shownPage.reported"
      :labels="composerLabels"
      :page-skill="shownSkill"
      @error="composerProblem = $event"
    />
    <p v-if="!props.navigate && composerProblem" class="page-composer-error" role="alert">{{ composerProblem }}</p>
  </template>
  </div>
</template>

<style scoped>
/* The application's area beside a conversation, where its theme is assigned; it lays out nothing of its own. */
.panel-application-area {
  display: contents;
}
/*
 * At full page the platform's page body already holds the gutter the header's title stands on: the panel's content starts
 * on the same line, with no inset of the host's own (visual acceptance E-01).
 */
.panel-host-page :deep(.panel-host-direct) {
  padding-inline: 0;
}
/* The page's own configuration error, where its composer would be: the reader is told, not left guessing. */
.page-composer-error {
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
