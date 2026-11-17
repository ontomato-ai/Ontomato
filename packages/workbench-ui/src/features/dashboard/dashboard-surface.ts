/**
 * Where a dashboard page is mounted: its own application at its address, or the page beside a conversation.
 *
 * The dashboard store is one per page load, so it cannot hold either of them: the page component that draws the board
 * forms this from its own context — the address's `?dashboardId=` at its own address, the conversation's page parameter
 * beside one — and hands it to the store while it is mounted, clearing it when it goes. One component, two contexts, and
 * no second router.
 */
export interface DashboardSurface {
  /** The board this surface shows; empty shows the first one. */
  dashboardId: string;
  /** The board chosen in the page: the surface's own navigation (the address, or the conversation's page parameter). */
  navigate(dashboardId: string | undefined): void;
}
