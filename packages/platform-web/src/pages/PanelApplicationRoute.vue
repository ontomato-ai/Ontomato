<script setup lang="ts">
import { computed, inject, markRaw, ref, shallowRef, toRaw, watch, watchEffect, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, panelUnavailable, useApplicationFrame, useApplicationTheme, useAppTheme, usePageHeading, useUnsavedChanges, type DirectPanelRun, type PanelHostLabels, type PanelHostPort, type PanelInstanceView, type PlatformPageHeading } from "@ontomato/platform-shell";
import { applicationPanelAddress, panelAddress, panelAddressState, panelUsePath, parseApplicationPanelAddress } from "@ontomato/contracts/panel-host";
import type { PanelDeepLinkStateValue } from "@ontomato/contracts/panel-manifest";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import { applicationFrameContextOf, type ApplicationEntryResolution, type ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { PageComposer, type DisplayObjectRefresh } from "@ontomato/agent-shell-ui";
import { countedTypesChangedKey } from "@ontomato/ontology-manager";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import { framePanelHost, platformPanelHost, resolveApplicationEntry, type PanelObjectChange } from "../panel-host";
import EntryUnit from "./EntryUnit.vue";
import { copyExternalLink } from "../external-link";
import { entryCountsChanged } from "../entry-counts";
import { Link } from "lucide-vue-next";
import { expandDeclaredComposer, hostThemeMode } from "../app-host";
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
  if (change.affected) {
    countedTypesChanged?.(change.affected.objectTypes);
    entryCountsChanged();
  }
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

// Another application is another set of pages: the kept ones of the application left are dropped. At once, as the
// route's application changes: the same route instance serves the next application's entry (one panel route serves
// every built-in application's entries), and the page it opens must not be dropped with the old ones.
watch(() => props.applicationId, () => {
  kept.value = [];
  failure.value = "";
  emit("display-loaded", { status: "loading" });
}, { immediate: true, flush: "sync" });

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

/*
 * An application's own frame (product-layer standard, part one; design §三, big main's rulings 2026-11-21): when Java's
 * answer names a frame panel, that panel stands in the application's area at full page instead of the platform's
 * application menu, and the entry's page — the platform's header and the content, one unit — stands where the frame's
 * \`<current-entry>\` is. The frame stays while the reader goes from entry to entry; the unit's content changes. Its state
 * rides in the address's \`frame\` segment, beside the content's \`state\`; beside a conversation no frame is drawn, but
 * the same segment gives the content the values the frame shares.
 */
/**
 * The frame's state as the frame last reported it, for the frame panel that reported it: going from entry to entry the
 * frame stays, and so does its state (design §三: another entry of the application takes the frame's public context
 * along), whether or not the address the reader went to names it.
 */
type FrameState = ReturnType<typeof parseApplicationPanelAddress>["frame"];
const lastFrame = shallowRef<{ framePanelId: string; state: FrameState } | null>(null);
/** The address's `frame` segment, or — for an address without one while the same frame stands — the frame's own state. */
const frameState = computed((): FrameState => {
  let named: FrameState;
  let hasSegment: boolean;
  try {
    hasSegment = new URLSearchParams(opened.value.split("?")[1] ?? "").has("frame");
    named = parseApplicationPanelAddress(opened.value).frame;
  } catch {
    return {};
  }
  // An address that names the frame's state is read as it is: the frame's own reports reach it through the address.
  if (hasSegment) return named;
  // While the next entry's answer is coming, the frame that stands is still the one that reported.
  return lastFrame.value?.state ?? named;
});
const framed = computed(() => !props.navigate && Boolean(resolution.value?.framePanelId));
useApplicationFrame(() => framed.value);
let frameFor: { framePanelId: string; port: PanelHostPort } | null = null;
const framePort = computed(() => {
  const answer = resolution.value;
  if (!framed.value || !answer?.framePanelId) return null;
  if (frameFor?.framePanelId !== answer.framePanelId)
    frameFor = { framePanelId: answer.framePanelId, port: markRaw(framePanelHost(props.applicationId, answer.use, answer.framePanelId, changed)) };
  return frameFor.port;
});
const frameContext = computed(() => resolution.value ? applicationFrameContextOf(resolution.value) : null);
/** Where the entry's page is while no frame holds it, and the unit itself. */
const holder = ref<HTMLElement | null>(null);
const unit = ref<{ $el: HTMLElement } | null>(null);
const currentEntry: NonNullable<DirectPanelRun["currentEntry"]> = {
  entry: computed(() => frameContext.value!.currentEntry),
  menu: computed(() => frameContext.value!.menu),
  place(element) {
    // The unit the route holds is moved into the frame's place, never mounted again: the frame cannot replace it.
    const stop = watchEffect(() => {
      const el = unit.value?.$el;
      if (el && el.parentElement !== element) element.appendChild(el);
    });
    return {
      dispose() {
        stop();
        const el = unit.value?.$el;
        if (el && holder.value && el.parentElement === element) holder.value.appendChild(el);
      },
    };
  },
};
/** The frame's own address: the entry's path, with the frame's state in it as the instance reports state. */
const frameAddress = computed(() => panelAddress(openedPath.value, {}));
/** The frame reported its state: the address carries it as \`frame\`, and the content's state stays as it is. */
function reportFrameAddress(input: DisplayPageAddressInput) {
  const reported = panelAddressState(input.address);
  const framePanelId = resolution.value?.framePanelId;
  if (framePanelId) lastFrame.value = { framePanelId, state: reported as FrameState };
  const { path, state, query } = parseApplicationPanelAddress(opened.value);
  const next = applicationPanelAddress(path, { frame: reported as never, state, query });
  if (next !== opened.value) void router.replace(next);
}
/** An entry opened without the frame's segment while the frame stands: its address takes the frame's state back. */
watch([opened, () => resolution.value?.framePanelId], () => {
  const kept = lastFrame.value;
  const framePanelId = resolution.value?.framePanelId;
  // Another frame, or none, answers for this application now: the state kept was another frame's.
  if (kept && resolution.value && kept.framePanelId !== framePanelId) lastFrame.value = null;
  if (!framed.value || !kept || kept.framePanelId !== framePanelId || !Object.keys(kept.state).length) return;
  if (new URLSearchParams(opened.value.split("?")[1] ?? "").has("frame")) return;
  const { path, state, query } = parseApplicationPanelAddress(opened.value);
  void router.replace(applicationPanelAddress(path, { frame: kept.state, state, query }));
});
const headerLabels = computed(() => ({ save: t("platform.save"), discard: t("platform.discard"), unsavedChanges: t("platform.unsavedChanges") }));

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
  draft: {
    opening: t("platform.panelDraftOpening"),
    close: t("platform.panelDraftClose"),
    toAgent: t("platform.panelDraftToAgent"),
    // The host puts the reason where `{reason}` stands.
    toAgentText: t("platform.panelDraftToAgentText", { reason: "{reason}" }),
  },
  refresh: t("common.refresh"),
}));

/**
 * Hands why the linked draft could not be used back to the agent: the page's composer (beside a conversation, the
 * conversation's) opens on the page's agent with the sentence, for the reader to send or change.
 */
function draftToAgent(text: string) {
  expandDeclaredComposer({ target: { kind: "page-default" }, prefill: text });
}

/**
 * The reader closed the notice of a draft the shown page cannot use: the page opens as it does without the draft — its
 * entry's own address, the panel's defaults, no form left half open — as its menu row does. A frame keeps its own state.
 */
function leaveDraft() {
  const page = shownPage.value;
  if (!page) return;
  reportAddress({ kind: "state", address: applicationPanelAddress(panelUsePath(page.use.path), { frame: frameState.value }) });
}

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
    "literal" in input ? [[field, input.literal as PanelDeepLinkStateValue]]
      // A value the frame shares: its state as the address's \`frame\` segment carries it, framed or beside a conversation.
      : Object.hasOwn(frameState.value, input.frameState) ? [[field, frameState.value[input.frameState]!]] : []));
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
const heading = computed<PlatformPageHeading | null>(() => {
  const title = shownPage.value?.context?.label || pageName.value;
  if (!title) return null;
  const description = pageDescription.value;
  // Every entry offers its external link: its address as the reader is on it, state and all (big main's ruling, 2026-11-21).
  return { title, ...description ? { description } : {}, ...use.value?.names ? {} : { back: goBack }, externalLink: opened.value };
});
/** The "more" of the header the frame holds: the same external link the platform's header offers. */
const entryMore = computed(() => heading.value?.externalLink ? [{
  id: "copy-external-link", label: t("platform.copyExternalLink"), icon: Link,
  onClick: () => void copyExternalLink(heading.value!.externalLink!, { copied: t("platform.externalLinkCopied"), title: t("platform.copyExternalLink") }),
}] : []);
if (!props.navigate) usePageHeading(() => (framed.value ? null : heading.value));
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
/** The opening state last handed to each page: the same object while its content is the same, so the host sees no change. */
const handed = new WeakMap<KeptPage, { key: string; state: Record<string, unknown> }>();
function stateOf(page: KeptPage) {
  const state = page === shownPage.value && opened.value.includes("?") ? requestedState.value : panelAddressState(page.reported);
  const inputs = entryInputs(page.use);
  if (!Object.keys(inputs).length) return state;
  const merged = { ...state, ...inputs };
  const key = JSON.stringify(merged);
  const last = handed.get(toRaw(page));
  if (last?.key === key) return last.state;
  handed.set(toRaw(page), { key, state: merged });
  return merged;
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
    <p v-if="failure" class="panel-application-status platform-page-gutter" role="alert">{{ failure }}</p>
    <p v-else-if="missing" class="panel-application-status platform-page-gutter" role="alert">{{ missing }}</p>
    <template v-if="!failure">
      <PanelHost
        v-if="framePort"
        key="frame"
        class="panel-application-frame"
        :port="framePort"
        :labels="labels"
        :language="language"
        :address="frameAddress"
        :initial="frameState"
        :current-entry="currentEntry"
        :history-back="false"
        @display-address="reportFrameAddress"
      />
      <div v-if="framePort" ref="holder" class="panel-entry-holder">
        <EntryUnit ref="unit" :heading="heading" :labels="headerLabels" :back-label="t('common.back')" :more="entryMore" :more-label="t('common.more')">
          <PanelHost
            v-for="page in kept"
            v-show="page === shownPage"
            :key="page.use.id"
            :ref="(instance) => { if (page === shownPage) host = instance as ShownInstance | null; }"
            :class="{ 'panel-host-page': !props.navigate }"
            :port="page.port"
            :labels="labels"
            :language="language"
            :shown="page === shownPage"
            :wired="Object.keys(page.use.inputs ?? {})"
            :address="addressOf(page)"
            :initial="stateOf(page)"
            :frame-state="frameState"
            :draft-to-agent="draftToAgent"
            :leave-draft="leaveDraft"
            :history-back="!props.navigate"
            @display-address="(input: DisplayPageAddressInput) => page === shownPage && reportAddress(input)"
            @display-loaded="(load: DisplayLoad) => page === shownPage && emit('display-loaded', load)"
            @display-dirty="(dirty: boolean) => reportDirty(page, dirty)"
            @context="(context: PageContext) => reportContext(page, context)"
            @reopened="markReopened(page)"
            @withdrawn="withdraw(page)"
          />
          <template v-if="!props.navigate && ((shownPage && shownSkill) || composerProblem)" #foot>
            <PageComposer
              v-if="shownPage && shownSkill"
              :page="shownPage.reported"
              :labels="composerLabels"
              :page-skill="shownSkill"
              @error="composerProblem = $event"
            />
            <p v-if="composerProblem" class="page-composer-error" role="alert">{{ composerProblem }}</p>
          </template>
        </EntryUnit>
      </div>
      <template v-else>
        <PanelHost
          v-for="page in kept"
          v-show="page === shownPage"
          :key="page.use.id"
          :ref="(instance) => { if (page === shownPage) host = instance as ShownInstance | null; }"
          :class="{ 'panel-host-page': !props.navigate }"
          :port="page.port"
          :labels="labels"
          :language="language"
          :shown="page === shownPage"
          :wired="Object.keys(page.use.inputs ?? {})"
          :address="addressOf(page)"
          :initial="stateOf(page)"
          :frame-state="frameState"
          :draft-to-agent="draftToAgent"
          :leave-draft="leaveDraft"
          :history-back="!props.navigate"
          @display-address="(input: DisplayPageAddressInput) => page === shownPage && reportAddress(input)"
          @display-loaded="(load: DisplayLoad) => page === shownPage && emit('display-loaded', load)"
          @display-dirty="(dirty: boolean) => reportDirty(page, dirty)"
          @context="(context: PageContext) => reportContext(page, context)"
          @reopened="markReopened(page)"
          @withdrawn="withdraw(page)"
        />
        <!-- Offered once the panel's read named the page's skill: the agents are the ones that skill reaches. -->
        <div v-if="!props.navigate && ((shownPage && shownSkill) || composerProblem)" class="panel-page-foot platform-page-gutter">
          <PageComposer
            v-if="shownPage && shownSkill"
            :page="shownPage.reported"
            :labels="composerLabels"
            :page-skill="shownSkill"
            @error="composerProblem = $event"
          />
          <p v-if="composerProblem" class="page-composer-error" role="alert">{{ composerProblem }}</p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Where the entry's page waits until the frame places it; once placed, it is in the frame and this holds nothing. */
.panel-entry-holder {
  display: none;
}
/* A custom application frame fills the application area edge-to-edge without host inset. */
.panel-application-frame {
  --panel-host-padding-inline: 0px;
  --panel-host-padding-top: 0px;
  --panel-host-padding-bottom: 0px;
  flex: 1;
}
/* Fills the layout body or side pane as a definite-height flex column; carries the application theme beside a conversation. */
.panel-application-area {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  padding-bottom: var(--pane-dock-space, 0px);
  overflow: hidden;
}
.panel-application-status {
  flex-shrink: 0;
  margin: 0;
  padding-block: var(--page-content-gap);
}
/*
 * At full page (and inside a frame's EntryUnit), the host's content box aligns horizontally with the page header's
 * gutter while keeping its scrollbar flush with the right edge (visual acceptance E-01).
 */
.panel-host-page {
  --panel-host-padding-inline: var(--page-gutter);
  --panel-host-padding-top: var(--page-content-gap);
  --panel-host-padding-bottom: var(--spacing-md);
}
.panel-page-foot {
  flex-shrink: 0;
}
/* The page's own configuration error, where its composer would be: the reader is told, not left guessing. */
.page-composer-error {
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
