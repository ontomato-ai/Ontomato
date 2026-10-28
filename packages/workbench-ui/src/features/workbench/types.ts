import type { DashboardListItem } from "@ontomato/contracts/dashboard";

export type DashboardSidebarItem = Pick<DashboardListItem, "id" | "name"> &
  Partial<Pick<DashboardListItem, "updatedAt">> & { charts?: number };
