import { defineAsyncComponent } from "vue";
import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/**
 * The pages this assembly mounts beside the conversation (DESIGN.md "Applications and shells"). Each is the page's own
 * route component, given the props its address names, so the page beside the conversation is that page — one instance,
 * one address — and enlarging it goes to the address itself.
 *
 * Only the pages whose own line has finished registering are here: the dashboards now, the knowledge report when its
 * migration lands, the agent settings inside the workbench that already mounts them.
 */
const dashboards = defineAsyncComponent(() => import("./pages/DashboardsRoute.vue"));

const pages: readonly { prefix: string; page: PilotPage }[] = [
  { prefix: platformRoutes.dashboards.path, page: { address: platformRoutes.dashboards.path, component: dashboards } },
];

/** The page an address opens beside the conversation, or null for an address that is no registered page. */
export const resolvePilotPage: PilotPageResolver = (address) => {
  const path = address.split("?")[0]!.replace(/\/+$/, "");
  return pages.find((candidate) => path === candidate.prefix)?.page ?? null;
};
