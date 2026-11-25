import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { RECENT_VISIT } from "@ontomato/contracts/platform-object-types";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { personalWorkspaceStore } from "../personal-workspace/store";
import type { ProductOwner } from "../product-governance/grants";
import { applicationCatalogueClient } from "./application-catalogue";

const recentText = (locale: string | undefined, key: string) => tForLocale(locale, `panels.recentVisit.${key}`);

export function createRecentVisitReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const language = resolveLocale(viewer.locale);
  const fieldLabels = {
    title: recentText(viewer.locale, "title"),
    appName: recentText(viewer.locale, "appName"),
    context: recentText(viewer.locale, "context"),
    visitedAt: recentText(viewer.locale, "visitedAt"),
  };

  return {
    async list(params: { limit?: number } = {}): Promise<PanelRecord[]> {
      const limit = Math.max(1, Math.min(20, params.limit ?? 8));
      const [visits, catalog] = await Promise.all([
        personalWorkspaceStore.recent(owner),
        applicationCatalogueClient(viewer).navigation().catch(() => []),
      ]);
      const appsById = new Map(catalog.map(app => [app.id, app]));
      const visible = catalog.length > 0
        ? visits.filter(item => appsById.has(item.appId))
        : visits;

      return visible.slice(0, limit).map(item => {
        const app = appsById.get(item.appId);
        const appName = app ? (localizedApplicationText(app.names, language) ?? app.id) : item.appId;
        const subtitle = appName;
        return {
          className: RECENT_VISIT,
          primaryKey: item.path,
          label: item.title,
          ...(subtitle && subtitle !== item.title ? { subtitle } : {}),
          fields: {
            appId: item.appId,
            appName,
            icon: app?.icon ?? "",
            title: item.title,
            context: "",
            path: item.path,
            visitedAt: item.visitedAt,
          },
          fieldLabels,
          outputs: {
            openPath: item.path,
          },
        };
      });
    },
  };
}
