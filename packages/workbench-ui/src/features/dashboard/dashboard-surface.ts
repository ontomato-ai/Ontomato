import { inject, provide, type InjectionKey } from "vue";

/**
 * Where a dashboard is shown: its own application at its address, or the page beside a conversation. A page beside the
 * conversation has no address of its own in the browser, so the board it shows and the board it moves to belong to the
 * assembly that mounts it — one component, two ways to know where it is, no second router.
 */
export interface DashboardSurface {
  /** The board this surface shows; empty shows the first one. */
  dashboardId: string;
  /** The board chosen in the page: the surface's own navigation (the address, or the conversation's page parameter). */
  navigate(dashboardId: string | undefined): void;
}

export const dashboardSurfaceKey: InjectionKey<DashboardSurface> = Symbol("dashboard-surface");

/** What a dashboard page is mounted on, or null when it is the application at its own address. */
export function useDashboardSurface(): DashboardSurface | null {
  return inject(dashboardSurfaceKey, null);
}

/** Called by the frame that mounts a dashboard beside something else (the conversation shell's page pane). */
export function provideDashboardSurface(surface: DashboardSurface) {
  provide(dashboardSurfaceKey, surface);
}
