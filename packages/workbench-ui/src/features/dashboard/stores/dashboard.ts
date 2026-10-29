import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  createDashboard as apiCreateDashboard,
  deleteDashboard as apiDeleteDashboard,
  fetchDashboardList,
  renameDashboard as apiRenameDashboard,
} from "../api";
import type { DashboardSidebarItem } from "../../workbench";
import { t } from "../../../i18n";


export const useDashboardStore = defineStore("dashboard", () => {
  const route = useRoute();
  const router = useRouter();
  const dashboardItems = ref<DashboardSidebarItem[]>([]);
  const loadingDashboards = ref(false);
  const editingDashboardId = ref("");
  const editingDashboardName = ref("");

  const currentDashboardId = computed(() => {
    const raw = route.query.dashboardId;
    return typeof raw === "string"
      ? raw.trim()
      : Array.isArray(raw)
        ? String(raw[0] || "").trim()
        : "";
  });
  const isDashboardView = computed(() => Boolean(currentDashboardId.value));
  function updateRoute(patch: Record<string, string | undefined>) {
    const nextQuery: Record<string, any> = { ...route.query };
    for (const [key, value] of Object.entries(patch)) {
      if (value) nextQuery[key] = value;
      else delete nextQuery[key];
    }
    return router.replace({ query: nextQuery });
  }

  function selectDashboard(dashboardId?: string) {
    const id = String(dashboardId || "").trim();
    return updateRoute({ dashboardId: id || undefined });
  }

  async function loadDashboards(options: { notifyError?: boolean } = {}) {
    loadingDashboards.value = true;
    try {
      const list = await fetchDashboardList();
      dashboardItems.value = (Array.isArray(list) ? list : [])
        .map((item: any) => ({
          id: String(item?.id || "").trim(),
          name: String(item?.name || item?.id || "").trim(),
          charts: item?.charts,
          updatedAt: item?.updatedAt,
        }))
        .filter((item) => item.id);
    } catch (error: any) {
      dashboardItems.value = [];
      if (options.notifyError) {
        ElMessage.error(error?.message || t("analysis.getDashboardFailed"));
      }
    } finally {
      loadingDashboards.value = false;
    }
  }

  async function createDashboard(name: string) {
    return apiCreateDashboard(name);
  }

  async function promptCreateDashboard() {
    try {
      const { value } = await ElMessageBox.prompt(
        t("analysis.enterDashboardName"),
        t("analysis.createDashboard"),
        {
          confirmButtonText: t("common.create"),
          cancelButtonText: t("common.cancel"),
          inputValidator: (input: string) => {
            const name = String(input || "").trim();
            if (!name) return t("common.nameRequired");
            if (name.length > 50) return t("common.nameTooLong");
            return true;
          },
        }
      );
      const name = String(value || "").trim();
      if (!name) return;
      const created = await createDashboard(name);
      await loadDashboards();
      if (created?.id) {
        void selectDashboard(created.id);
      }
    } catch {
      // Cancelled or failed
    }
  }

  function startDashboardRename(dashboard: { id: string; name: string }) {
    editingDashboardId.value = dashboard.id;
    editingDashboardName.value = dashboard.name;
  }

  function cancelDashboardRename() {
    editingDashboardId.value = "";
    editingDashboardName.value = "";
  }

  async function saveDashboardRename(dashboard: { id: string; name: string }) {
    const id = String(dashboard.id || "").trim();
    const name = String(editingDashboardName.value || "").trim();
    if (!id || !name) return cancelDashboardRename();
    try {
      await apiRenameDashboard(id, name);
      ElMessage.success(t("common.renamed"));
      cancelDashboardRename();
      await loadDashboards();
    } catch (error: any) {
      ElMessage.error(error?.message || t("admin.renameFailed"));
      cancelDashboardRename();
    }
  }

  async function deleteDashboard(dashboard: { id: string; name: string }) {
    const id = String(dashboard.id || "").trim();
    if (!id) return;
    try {
      await ElMessageBox.confirm(
        t("dashboard.deleteDashboardConfirm", { name: dashboard.name || id }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
        }
      );
    } catch {
      return;
    }
    try {
      await apiDeleteDashboard(id);
      ElMessage.success(t("common.deleted"));
      if (id === currentDashboardId.value) void selectDashboard();
      await loadDashboards();
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.deleteFailed"));
    }
  }

  function handleDashboardCommand(command: string, dashboard: { id: string; name: string }) {
    if (command === "rename") startDashboardRename(dashboard);
    if (command === "delete") deleteDashboard(dashboard);
  }

  function openDashboard(id: string) {
    void selectDashboard(id);
  }

  return {
    currentDashboardId,
    isDashboardView,
    dashboardItems,
    loadingDashboards,
    editingDashboardId,
    editingDashboardName,
    selectDashboard,
    loadDashboards,
    createDashboard,
    promptCreateDashboard,
    startDashboardRename,
    cancelDashboardRename,
    saveDashboardRename,
    deleteDashboard,
    handleDashboardCommand,
    openDashboard,
  };
});
