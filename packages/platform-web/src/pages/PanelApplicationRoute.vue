<script setup lang="ts">
import { computed, inject, markRaw, onBeforeUnmount, ref, shallowRef, toRaw, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElSkeleton } from "element-plus";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import { PanelHost, panelUnavailable, useApplicationFrame, useApplicationTheme, useAppTheme, useUnsavedChanges, type PanelHostLabels, type PanelHostPort, type PanelInstanceView } from "@ontomato/platform-shell";
import {
  applicationPanelAddress,
  panelAddressState,
  panelUsePath,
  parseApplicationPanelAddress,
} from "@ontomato/contracts/panel-host";
import { applicationRootPath } from "@ontomato/contracts/platform-identity";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelDeepLinkStateValue, PanelManifest } from "@ontomato/contracts/panel-manifest";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { applicationFrameContextOf, isNativeApplicationEntry, type ApplicationEntryResolution, type ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { PageComposer, type DisplayObjectRefresh, type DisplayPageController, type DisplayStateUpdate } from "@ontomato/agent-shell-ui";
import type { PageContext } from "@ontomato/contracts/page-context";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import { APPLICATION, FAVORITE } from "@ontomato/contracts/platform-object-types";
import { HOME_PREFERENCES_CHANGED } from "../features/home/api";
import { onPanelReadDenied, platformPanelHost, readApplicationFrameManifest, resolveApplicationEntry, type PanelObjectChange } from "../panel-host";
import {
  applicationFrameHostKey,
  deepLinkDefaultsOf,
  hasFrameParams,
  type FrameState,
  type PanelFrameRegistration,
} from "../application-frame-context";
import EntryUnit from "./EntryUnit.vue";
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
  liveState?: DisplayStateUpdate | null;
  registerPageController?: (controller: DisplayPageController) => () => void;
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
type ShownInstance = Pick<PanelInstanceView, "refresh" | "validateState" | "applyState" | "blocksNavigation" | "probePresentation" | "presentationAddress" | "fillForm" | "executeAction" | "snapshotMeta" | "isLoading">;
const host = ref<ShownInstance | null>(null);
/** Enclosing single outer frame host at full page; null beside a conversation (`props.navigate`). */
const outerFrame = props.navigate ? null : inject(applicationFrameHostKey, null);
let pendingControllerState: Record<string, RuntimeJsonValue> | null = null;
watch(host, (nextHost) => {
  if (!nextHost || !pendingControllerState) return;
  const patch = pendingControllerState;
  pendingControllerState = null;
  try {
    nextHost.applyState(patch);
  } catch (error) {
    emit("display-loaded", panelUnavailable(error));
  }
});
if (props.registerPageController) {
  const unregister = props.registerPageController({
    blocksNavigation(next) {
      return host.value?.blocksNavigation(next) ?? false;
    },
    async probePresentation(next) {
      return host.value?.probePresentation(next);
    },
    presentationAddress(address, patch) {
      return host.value?.presentationAddress(address, patch) ?? address;
    },
    validateState(patch) {
      host.value?.validateState(patch);
    },
    applyState(patch) {
      if (!host.value) {
        pendingControllerState = { ...(pendingControllerState ?? {}), ...patch };
        return;
      }
      host.value.applyState(patch);
    },
    fillForm(request) {
      if (!host.value) {
        return Promise.resolve({
          ok: false,
          reason: "form_not_ready",
          ...(request.member ? { member: request.member } : {}),
          ...(request.memberPath ? { memberPath: request.memberPath } : {}),
          message: "The panel is not mounted and ready for form filling.",
        });
      }
      return host.value.fillForm(request);
    },
    executeAction(request) {
      if (!host.value) {
        return Promise.resolve({
          ok: false,
          reason: "action_not_ready",
          operation: request.operation,
          message: "The panel is not mounted and ready for actions.",
        });
      }
      return host.value.executeAction(request);
    },
    snapshotMeta() {
      return host.value?.snapshotMeta?.() ?? {};
    },
    isLoading() {
      if (failure.value || missing.value) return false;
      if (verifying.value || !host.value) return true;
      return host.value.isLoading?.() ?? false;
    },
  });
  onBeforeUnmount(() => {
    pendingControllerState = null;
    unregister();
  });
}
/**
 * A change to objects the page shows, from the conversation or from a receipt for an operation in the shown frame: the
 * one place either is taken in. Both the entry panel and the enclosing application frame re-read what they display.
 */
function changed(change: PanelObjectChange) {
  host.value?.refresh(change.target, change.affected, change.operation);
  outerFrame?.refreshFrame(change);
  if (
    change.affected?.objectTypes?.includes(APPLICATION)
    || change.affected?.objectTypes?.includes(FAVORITE)
    || change.affected?.objects?.some((item) => item.objectType === APPLICATION || item.objectType === FAVORITE)
  ) {
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
  }
}
watch(() => props.objectRefresh?.seq, () => {
  if (props.objectRefresh) changed(props.objectRefresh);
}, { flush: "post" });

/**
 * How many of the application's pages keep their instance at once (design 7.2.1): the shown page and the five most
 * recently left clean pages, covering frequent switching across an application's core pages without rebuilding. Only a
 * page left with nothing unsaved is kept; a page left with unsaved changes is left through the platform's
 * unsaved-changes question, and its changes go with it.
 */
const KEPT_PAGES = 6;
/** How long the previous clean page stays visible during a same-application switch before showing the loading placeholder. */
const TRANSITION_PLACEHOLDER_DELAY_MS = 150;
/** Periodic silent refresh interval for the current application's entry table while the tab is visible. */
const ENTRY_TABLE_REFRESH_MS = 5 * 60 * 1000;

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
  /** True by default for synchronous mock hosts in tests; real PanelHost emits false on mount until its surface renders. */
  surfaceReady: boolean;
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
const besideFrameManifest = shallowRef<{ framePanelId: string; manifest: Pick<PanelManifest, "state"> } | null>(null);
const catalog = useApplicationCatalog();
/**
 * Java's answer for this application's entry (`resolve-entry`): the admitted use relation, frame panel, theme, and
 * visible entry menu. Same-application switches hitting the known entry table mount immediately without re-asking.
 */
const resolution = shallowRef<ApplicationEntryResolution | null>(null);
/** True while waiting for server admission on a direct link not present in the current application's entry table. */
const verifying = ref(false);
/** Entry path explicitly refused by the server (403/404 or mismatched application). */
const deniedPath = ref<string | null>(null);
const retainedPage = shallowRef<KeptPage | null>(null);
const transitionTimedOut = ref(false);
let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let resolveEpoch = 0;
let refreshInFlight: Promise<void> | null = null;
let unmounted = false;

function clearTransitionTimer() {
  if (transitionTimer !== null) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
}

function clearTransition() {
  clearTransitionTimer();
  retainedPage.value = null;
  transitionTimedOut.value = false;
}

function ensureTransitionTimer() {
  if (transitionTimer !== null || transitionTimedOut.value || !retainedPage.value) return;
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    transitionTimedOut.value = true;
    retainedPage.value = null;
  }, TRANSITION_PLACEHOLDER_DELAY_MS);
}

/** The page's address as the reader is on it: the conversation's page parameter beside a chat, the router's full. */
const opened = computed(() => props.address ?? route.fullPath);
const openedPath = computed(() => opened.value.split("?")[0]!);
const catalogApp = computed(() => catalog.applications.value.find((app) => app.id === props.applicationId) ?? null);
const currentResolution = computed(() =>
  resolution.value?.applicationId === props.applicationId ? resolution.value : null,
);
/** Known panel entry table for this application: authoritative resolution menu once received, else navigation catalog. */
const entryTable = computed<readonly ApplicationPanelUse[]>(() =>
  (currentResolution.value?.menu.panelUses ?? catalogApp.value?.panelUses ?? []).filter(
    (entry): entry is ApplicationPanelUse => !isNativeApplicationEntry(entry),
  ),
);
/** The entry an address opens: its own path, or the application's first listed entry at the application's own address. */
const entryPath = computed(() => {
  if (openedPath.value !== applicationRootPath(props.applicationId)) return openedPath.value;
  const first = entryTable.value[0];
  return first ? panelUsePath(first.path) : null;
});

function findEntryByPath(entries: readonly ApplicationPanelUse[], path: string): ApplicationPanelUse | null {
  return entries.find((candidate) => panelUsePath(candidate.path) === path) ?? null;
}

function revokeEntry(path: string) {
  kept.value = kept.value.filter((page) => panelUsePath(page.use.path) !== path);
  if (retainedPage.value && panelUsePath(retainedPage.value.use.path) === path) {
    clearTransition();
  }
  resolution.value = null;
  deniedPath.value = path;
  verifying.value = false;
}

async function requestEntryResolution(
  applicationId: string,
  path: string,
  options: { blocking: boolean; epoch?: number },
) {
  const epoch = options.epoch ?? ++resolveEpoch;
  if (options.blocking) {
    clearTransition();
    verifying.value = true;
  }
  try {
    const answer = await resolveApplicationEntry({ path });
    if (unmounted || epoch !== resolveEpoch || props.applicationId !== applicationId || entryPath.value !== path) return;
    if (answer.applicationId !== applicationId) {
      revokeEntry(path);
      return;
    }
    resolution.value = answer;
    deniedPath.value = null;
    verifying.value = false;
  } catch {
    if (unmounted || epoch !== resolveEpoch || props.applicationId !== applicationId || entryPath.value !== path) return;
    revokeEntry(path);
  }
}

function refreshEntryTable({ refreshCatalog }: { refreshCatalog: boolean }) {
  if (unmounted || verifying.value) return Promise.resolve();
  if (refreshInFlight) return refreshInFlight;
  const applicationId = props.applicationId;
  const path = entryPath.value;
  if (refreshCatalog) void catalog.refresh();
  if (!path) return Promise.resolve();
  const epoch = ++resolveEpoch;
  const task = requestEntryResolution(applicationId, path, { blocking: false, epoch }).finally(() => {
    if (refreshInFlight === task) refreshInFlight = null;
  });
  refreshInFlight = task;
  return task;
}

// Another application is another set of pages: drop kept pages and reset resolution/transition state at once
// so cross-application switches never flash the previous application's content or stale resolution.
watch(() => props.applicationId, (_next, previous) => {
  resolveEpoch += 1;
  refreshInFlight = null;
  kept.value = [];
  failure.value = "";
  resolution.value = null;
  verifying.value = false;
  deniedPath.value = null;
  clearTransition();
  if (previous !== undefined) {
    pendingControllerState = null;
    besideFrameManifest.value = null;
  }
  emit("display-loaded", { status: "loading" });
}, { immediate: true, flush: "sync" });

watch([() => props.applicationId, entryPath], ([applicationId, path]) => {
  const epoch = ++resolveEpoch;
  deniedPath.value = null;
  if (!path) {
    verifying.value = false;
    resolution.value = null;
    return;
  }
  const known = findEntryByPath(entryTable.value, path)
    ?? kept.value.find((page) => panelUsePath(page.use.path) === path)?.use
    ?? null;
  if (known) {
    verifying.value = false;
    if (!currentResolution.value) {
      void requestEntryResolution(applicationId, path, { blocking: false, epoch });
    }
    return;
  }
  void requestEntryResolution(applicationId, path, { blocking: true, epoch });
}, { immediate: true });

const stopVisibility = onDocumentVisibility((visible) => {
  if (visible) void refreshEntryTable({ refreshCatalog: true });
});
const stopReadDenied = onPanelReadDenied(() => {
  void refreshEntryTable({ refreshCatalog: true });
});
const refreshTimer = setInterval(() => {
  if (documentVisible()) void refreshEntryTable({ refreshCatalog: true });
}, ENTRY_TABLE_REFRESH_MS);

onBeforeUnmount(() => {
  unmounted = true;
  clearTransition();
  stopVisibility();
  stopReadDenied();
  clearInterval(refreshTimer);
});

const listedUse = computed<ApplicationPanelUse | null>(() =>
  entryPath.value ? findEntryByPath(entryTable.value, entryPath.value) : null,
);
const resolvedUse = computed<ApplicationPanelUse | null>(() => {
  const path = entryPath.value;
  const answer = currentResolution.value;
  if (!path || !answer) return null;
  return panelUsePath(answer.use.path) === path ? answer.use : null;
});
const keptUse = computed<ApplicationPanelUse | null>(() => {
  const path = entryPath.value;
  if (!path) return null;
  return kept.value.find((page) => panelUsePath(page.use.path) === path)?.use ?? null;
});
/**
 * The use relation the opened address names: admitted immediately when present in this application's known entry table
 * or already kept in this application (and confirmed by resolve-entry for direct links), and null while awaiting
 * direct-link verification or once refused.
 */
const use = computed<ApplicationPanelUse | null>(() => {
  const path = entryPath.value;
  if (!path || verifying.value || deniedPath.value === path) return null;
  return resolvedUse.value ?? listedUse.value ?? keptUse.value;
});
/**
 * The application's theme from Java's answer (a `panels` application's only). At full page the platform's layout assigns
 * it on the application's area, its menu and its page; beside a conversation it is assigned on this content alone.
 */
const area = ref<HTMLElement | null>(null);
if (props.navigate) useAppTheme(area, () => currentResolution.value?.theme, hostThemeMode);
else useApplicationTheme(() => currentResolution.value?.theme);
/** An address that names no use relation the reader may open is a page that cannot load, and its receipt says so. */
const missing = computed(() => !verifying.value && !use.value ? t("platform.panelNotInApplication", { path: openedPath.value }) : "");
watch(missing, (message) => {
  if (message) emit("display-loaded", panelUnavailable(new Error(message)));
});

/*
 * Outer frame integration: at full page, the enclosing `ApplicationFrameHost` owns the single persistent frame panel,
 * its shared `frame.*` URL state, and `<current-entry>` placement. This route only registers its current entry/menu
 * and reads `outerFrame.frameState`. Beside a conversation (`props.navigate`), no frame is mounted, so this route
 * reads the frame panel manifest alone to populate declared deep-link defaults and decode URL `frame.*` overrides.
 */
watch(
  [() => props.applicationId, () => props.navigate, () => currentResolution.value?.framePanelId, () => use.value?.id],
  ([applicationId, navigate, framePanelId], _, onCleanup) => {
    if (outerFrame) return;
    let current = true;
    onCleanup(() => { current = false; });
    if (!framePanelId) {
      besideFrameManifest.value = null;
      return;
    }
    const activeUse = use.value;
    if (!navigate || !activeUse) return;
    void readApplicationFrameManifest(applicationId, activeUse, framePanelId).then((manifest) => {
      if (!current) return;
      besideFrameManifest.value = { framePanelId, manifest };
    }, () => {
      if (current) besideFrameManifest.value = null;
    });
  },
  { immediate: true },
);
const activeBesideFrameManifest = computed(() =>
  currentResolution.value?.framePanelId && besideFrameManifest.value?.framePanelId === currentResolution.value.framePanelId
    ? besideFrameManifest.value.manifest
    : undefined,
);
const frameState = computed((): FrameState => {
  if (outerFrame) return outerFrame.frameState.value;
  let named: FrameState;
  let hasSegment: boolean;
  try {
    hasSegment = hasFrameParams(opened.value);
    named = parseApplicationPanelAddress(
      opened.value,
      activeBesideFrameManifest.value ? { frameManifest: activeBesideFrameManifest.value } : undefined,
    ).frame;
  } catch {
    return {};
  }
  const defaults = deepLinkDefaultsOf(activeBesideFrameManifest.value);
  if (hasSegment) return { ...defaults, ...named };
  return Object.keys(defaults).length ? defaults : named;
});
/** True while this full-page route is framed or awaiting admission for an application that declares a frame panel. */
const expectingFrame = computed(() => {
  if (props.navigate || missing.value) return false;
  if (currentResolution.value) return Boolean(currentResolution.value.framePanelId);
  return !deniedPath.value && Boolean(catalogApp.value?.framePanelId);
});
useApplicationFrame(() => expectingFrame.value);

const frameContext = computed(() => {
  const answer = currentResolution.value;
  if (!answer) return null;
  return applicationFrameContextOf({
    ...answer,
    use: use.value ?? answer.use,
  });
});

if (outerFrame) {
  const registration = computed<PanelFrameRegistration>(() => {
    const answer = currentResolution.value;
    const activeUse = use.value;
    const context = frameContext.value;
    const resolved = Boolean(answer || deniedPath.value || missing.value);
    return {
      applicationId: props.applicationId,
      framePanelId: answer ? answer.framePanelId : (!deniedPath.value ? catalogApp.value?.framePanelId : undefined),
      resolved,
      missing: Boolean(missing.value),
      use: activeUse,
      currentEntry: context?.currentEntry ?? (activeUse ? {
        applicationId: props.applicationId,
        useId: activeUse.id,
        pageKey: activeUse.pageKey,
        panelId: activeUse.panelId,
        path: panelUsePath(activeUse.path),
      } : null),
      menu: context?.menu ?? null,
      onObjectChange(change) {
        host.value?.refresh(change.target, change.affected, change.operation);
      },
    };
  });
  const unregisterFrameEntry = outerFrame.registerPanelEntry(registration);
  onBeforeUnmount(unregisterFrameEntry);
}

const showContentLoading = computed(() =>
  !missing.value
  && !displayedPage.value
  && !(outerFrame?.active.value && !outerFrame.surfaceReady.value),
);

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
 * The page's address without the panel's own state: this relation's own full path and any preserved shell query
 * parameters. The state is the instance's to add.
 */
const pageAddress = computed(() => {
  const search = opened.value.split("?")[1];
  const path = use.value ? panelUsePath(use.value.path) : "";
  return search ? `${path}?${search}` : path;
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
const pageName = computed(() => localizedApplicationText(use.value?.names, locale.value) ?? "");

const shownPage = computed(() =>
  kept.value.find((page) => page.use.id === use.value?.id && page.use.panelId === use.value?.panelId) ?? null,
);
watch(shownPage, (next) => {
  if (!next) host.value = null;
});
/**
 * The visually displayed page: the logical current page once its surface is ready, otherwise the retained previous
 * page of the same application for up to TRANSITION_PLACEHOLDER_DELAY_MS, else null (loading placeholder).
 */
const displayedPage = computed<KeptPage | null>(() => {
  const current = shownPage.value;
  if (current?.surfaceReady) return current;
  const retained = retainedPage.value;
  if (current && retained && !transitionTimedOut.value && retained.surfaceReady) {
    const alive = kept.value.find((page) => toRaw(page) === toRaw(retained));
    if (alive) return alive;
  }
  return null;
});

/**
 * The page the reader opens becomes the shown one: a kept page as it was left, or a new instance. At `KEPT_PAGES`, the
 * page with nothing unsaved that the reader left longest ago is dropped to make room.
 *
 * The page the reader opened is known before its frame has loaded: its name and address go to the conversation at once,
 * with no selection, since the panel has not said what it shows yet. What the frame reports later adds that; a kept page
 * says what it showed when it was left.
 */
watch(use, (next, previous) => {
  // Same entry bound to the same panel: nothing to switch or rebuild.
  if (next && previous?.id === next.id && previous.panelId === next.panelId) return;
  // A page left with unsaved changes was left through the unsaved-changes question: its changes go with its instance.
  const left = previous && previous.id !== next?.id ? kept.value.find((page) => page.use.id === previous.id) : undefined;
  if (left?.dirty) kept.value = kept.value.filter((page) => page !== left);
  // Drop any kept instance for the same use relation if it was rebound to a different panel.
  if (next) {
    kept.value = kept.value.filter((page) => !(page.use.id === next.id && page.use.panelId !== next.panelId));
  }
  shownSkill.value = null;
  if (!next) {
    clearTransition();
    return;
  }
  performance.mark("ontomato:panel-page-opened", { detail: { applicationId: props.applicationId, useId: next.id } });
  const found = kept.value.find((page) => page.use.id === next.id && page.use.panelId === next.panelId);
  if (found) found.lastShown = ++showings;
  else if (kept.value.length >= KEPT_PAGES) {
    const [oldest] = [...kept.value].sort((one, other) => one.lastShown - other.lastShown);
    kept.value = kept.value.filter((page) => page !== oldest);
  }
  const page = found ?? openPage(next);
  if (!found) kept.value = [...kept.value, page];

  const wasTimedOut = transitionTimedOut.value;
  clearTransitionTimer();
  transitionTimedOut.value = false;
  if (found && found.surfaceReady) {
    retainedPage.value = null;
  } else {
    const candidate = left && !left.dirty && left.surfaceReady ? left : (!wasTimedOut ? retainedPage.value : null);
    const alive = candidate && toRaw(candidate) !== toRaw(page)
      ? kept.value.find((entry) => toRaw(entry) === toRaw(candidate) && entry.surfaceReady) ?? null
      : null;
    retainedPage.value = alive;
    if (!page.surfaceReady) ensureTransitionTimer();
  }

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
    reported: pageAddress.value,
    context: null,
    dirty: false,
    pageSkill: null,
    rechecking: false,
    surfaceReady: true,
    lastShown: ++showings,
  };
  page.port = markRaw(platformPanelHost(
    props.applicationId, use, changed, undefined, (context) => reportPageSkill(page, context),
    // Beside a conversation, an address the panel opens goes to the conversation's display; at full page, the router.
    props.navigate,
  ));
  return page;
}

function reportSurfaceReady(page: KeptPage, ready: boolean) {
  page.surfaceReady = ready;
  if (!shownPage.value || toRaw(page) !== toRaw(shownPage.value)) return;
  if (ready) clearTransition();
  else ensureTransitionTimer();
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
  if (retainedPage.value && toRaw(retainedPage.value) === toRaw(page)) clearTransition();
  const path = entryPath.value;
  if (path) void requestEntryResolution(props.applicationId, path, { blocking: true });
}

/**
 * The address and state each instance is given: the shown page follows the address the reader opened, unless that is its
 * bare address, which shows it as it was left; a kept page keeps its own, so nothing about another page reaches it.
 */
function addressOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? pageAddress.value : page.reported;
}
function stateOf(page: KeptPage) {
  return page === shownPage.value && opened.value.includes("?") ? requestedState.value : panelAddressState(page.reported);
}

const liveStatePatch = computed(() =>
  props.liveState && props.liveState.instance === openedPath.value ? props.liveState.patch : null,
);

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
    <EntryUnit v-if="!failure">
      <PanelHost
        v-for="page in kept"
        v-show="page === displayedPage"
        :key="`${page.use.id}:${page.use.panelId}`"
        :ref="(instance) => { if (page === shownPage) host = instance as ShownInstance | null; }"
        :class="{ 'panel-host-page': !props.navigate }"
        :port="page.port"
        :labels="labels"
        :language="language"
        :shown="page === shownPage"
        :wired="Object.keys(page.use.inputs ?? {})"
        :address="addressOf(page)"
        :initial="stateOf(page)"
        :entry-inputs="entryInputs(page.use)"
        :live-state="page === shownPage ? liveStatePatch : null"
        :frame-state="frameState"
        :history-back="!props.navigate"
        @display-address="(input: DisplayPageAddressInput) => page === shownPage && reportAddress(input)"
        @display-loaded="(load: DisplayLoad) => page === shownPage && emit('display-loaded', load)"
        @display-dirty="(dirty: boolean) => reportDirty(page, dirty)"
        @context="(context: PageContext) => reportContext(page, context)"
        @surface-ready="(ready: boolean) => reportSurfaceReady(page, ready)"
        @reopened="markReopened(page)"
        @withdrawn="withdraw(page)"
      />
      <div
        v-if="showContentLoading"
        class="panel-application-loading"
        role="status"
        aria-busy="true"
        :aria-label="t('common.loading')"
        data-panel-loading-placeholder
      >
        <div class="panel-application-loading-inner">
          <ElSkeleton :rows="4" animated />
          <span class="panel-application-loading-text">{{ t("common.loading") }}</span>
        </div>
      </div>
      <!-- Offered once the panel's read named the page's skill: the agents are the ones that skill reaches. -->
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
</template>

<style scoped>
/* Fills the layout body or side pane as a definite-height flex column; carries the application theme beside a conversation. */
.panel-application-area {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.panel-application-status {
  flex-shrink: 0;
  margin: 0;
  padding-block: var(--page-content-gap);
}
.panel-application-loading {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: var(--page-content-gap, 16px) var(--page-gutter, 20px);
  background: var(--el-bg-color);
  box-sizing: border-box;
}
.panel-application-loading-inner {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
  width: 100%;
  max-width: 960px;
}
.panel-application-loading-text {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
@media (prefers-reduced-motion: reduce) {
  .panel-application-loading :deep(.el-skeleton__item) {
    animation: none;
  }
}
/* The page's own configuration error, where its composer would be: the reader is told, not left guessing. */
.page-composer-error {
  pointer-events: auto;
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
