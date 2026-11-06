<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRoute, useRouter, type LocationQueryValue } from "vue-router";
import { useI18n } from "vue-i18n";
import { Plus } from "lucide-vue-next";
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { appIcon } from "@ontomato/platform-shell";
import { schedulesHost } from "@ontomato/workbench-ui";
import { appPartitionKey } from "../app-partition";
import AppPage from "./AppPage.vue";

/**
 * The scheduled tasks application: every task the account created, of every application that can run on a schedule,
 * as cards.
 *
 * The header is the platform's one page header, and its button opens the page's form. The page names applications as
 * the rail does — from the partition the shell draws — and opens a result through this router, which adds the
 * deployment's prefix. The address keeps the application filter (`?app=`) and the run record a link opens
 * (`?taskId=&runId=`, the address an action's or a function's result points at).
 */
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const page = ref<{ openNewTask: () => void } | null>(null);

const partition = inject(appPartitionKey);
if (!partition) throw new Error("The scheduled tasks page is shown outside the platform shell that names its applications");

const host = schedulesHost({
  applications: () => partition.value.map((app) => ({ id: app.id, label: t(app.labelKey), icon: appIcon(app.icon) })),
  openResult: (link) => void router.push(link.path),
});

const single = (value: LocationQueryValue | LocationQueryValue[] | undefined) =>
  typeof value === "string" && value ? value : null;
const app = computed(() => single(route.query.app));
const taskId = computed(() => single(route.query.taskId));
const runId = computed(() => single(route.query.runId));

function changeQuery(change: Record<string, string | null>) {
  const query = { ...route.query };
  for (const [key, value] of Object.entries(change)) {
    if (value) query[key] = value;
    else delete query[key];
  }
  void router.replace({ path: route.path, query });
}

const actions = computed(() => [
  {
    id: "new-task",
    label: t("platformSchedules.newTask"),
    primary: true,
    icon: Plus,
    onClick: () => page.value?.openNewTask(),
  },
]);
</script>

<template>
  <AppPage
    :title="t('platformSchedules.title')"
    :description="t('platformSchedules.intro')"
    :actions="actions"
    :labels="{ save: t('platform.save'), discard: t('platform.discard'), unsavedChanges: t('platform.unsavedChanges') }"
  >
    <PlatformSchedulesPage
      ref="page"
      :host="host"
      :app="app"
      :task-id="taskId"
      :run-id="runId"
      @select-app="changeQuery({ app: $event })"
      @records-closed="changeQuery({ taskId: null, runId: null })"
    />
  </AppPage>
</template>
