<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import {
  DashboardHome, useDashboardStore, type DashboardSurface,
} from "@ontomato/workbench-ui/features/dashboard";
import { DASHBOARDS_PAGE_SKILL } from "@ontomato/workbench-ui/features/workbench";
import { PageComposer } from "@ontomato/agent-shell-ui";
import AppPage from "./AppPage.vue";

/**
 * The dashboards application: the boards conversations add their charts and datasets to.
 *
 * One page, the whole of the application's area, under the platform's one page header (DESIGN.md "Admin page anatomy");
 * the boards are tabs of the page itself, and the address carries the open board as `?dashboardId=`, so a board can be
 * linked and reloaded.
 *
 * The same page also opens beside a conversation, mounted by the agent platform's page pane with the props of its
 * address: `paired`, `dashboardId` and `navigate`. Then it has no frame of its own (the shell draws the header and the
 * composer) and its board navigation goes through `navigate`, which changes the address the conversation carries.
 */
const props = withDefaults(
  defineProps<{
    paired?: boolean;
    /** The board the conversation's page parameter names; the address's own query when this page is the application. */
    dashboardId?: string;
    /** The page's own navigation beside a conversation: the conversation's parameter, not the browser's address. */
    navigate?: (next: { dashboardId?: string }) => void;
  }>(),
  { paired: false, dashboardId: undefined, navigate: undefined },
);

const { t } = useI18n();
const route = useRoute();
const store = useDashboardStore();

/*
 * The board this page shows is its own context, not the page load's: beside a conversation it is the conversation's page
 * parameter, at its own address the address's query. The page tells the store which it is while it is mounted, so the
 * store never keeps a surface from a page that has gone (the board stays correct across enlarging and collapsing).
 */
const shown = ref(props.dashboardId ?? "");
watch(() => props.dashboardId, (id) => (shown.value = id ?? ""));
const surface: DashboardSurface | null = props.paired
  ? {
      get dashboardId() {
        return shown.value;
      },
      navigate(dashboardId: string | undefined) {
        shown.value = dashboardId ?? "";
        props.navigate?.(dashboardId ? { dashboardId } : {});
      },
    }
  : null;
store.bindSurface(surface);
onBeforeUnmount(() => store.bindSurface(null));

// The address names the board; without one the first board opens, as the page always did.
const opened = store
  .loadDashboards({ notifyError: true })
  .then(() => {
    if (!store.currentDashboardId && store.dashboardItems[0]) void store.selectDashboard(store.dashboardItems[0].id);
  })
  .catch(() => {});
void opened;

/** The page's own configuration error: its composer names it and the page shows it, rather than choosing another agent. */
const problem = ref<string | null>(null);
const labels = computed(() => ({
  placeholder: t("assistant.placeholder"),
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  agent: t("assistant.agent"),
  pageAgentUnavailable: t("assistant.pageAgentUnavailable"),
}));
/** The page's own address: the counter opens this same board beside the message. */
const page = computed(
  () => `${route.path}${Object.keys(route.query).length ? `?${new URLSearchParams(route.query as Record<string, string>)}` : ""}`,
);
</script>

<template>
  <component :is="props.paired ? 'div' : AppPage" v-bind="props.paired ? {} : {
    title: t('assistant.featureDashboards'),
    labels: { save: t('common.save'), discard: t('common.cancel'), unsavedChanges: t('admin.unsavedChanges') },
  }">
    <DashboardHome />
    <!-- The page's own composer offers the agents this page can work with, the same declaration the conversation reads. -->
    <PageComposer v-if="!props.paired" :page="page" :labels="labels" :page-skill="DASHBOARDS_PAGE_SKILL" @error="problem = $event" />
    <p v-if="problem" class="page-composer-error" role="alert">{{ problem }}</p>
  </component>
</template>

<style scoped>
/* The page's own configuration error, at the foot where its composer would be: the reader is told, not left guessing. */
.page-composer-error {
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
