import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { HomeItemRef, HomeState } from "@ontomato/contracts/platform-home";
import type { PlatformAppDeclaration } from "../../apps";

/**
 * The home's own catalog entry. It is the platform's starting point, not something to find on it, so the square, the
 * favourites and the recent items leave it out, and opening it is not recorded as using an application.
 */
export const HOME_APPLICATION_ID = "home";

/** The square's categories: the catalog's functional groups, with the agents as one more. */
export const homeCategories = ["all", "business", "agents", "build", "admin"] as const;
export type HomeCategory = (typeof homeCategories)[number];

/** One card of the home: an application from the catalog or an agent of the current domain, named as they name it. */
export interface HomeItem {
  kind: HomeItemRef["kind"];
  id: string;
  label: string;
  description: string | null;
  icon: string;
  category: Exclude<HomeCategory, "all">;
}

export const itemKey = (item: Pick<HomeItemRef, "kind" | "id">) => `${item.kind}:${item.id}`;

/** The reference the server keeps for an item: its kind and id, nothing it shows. */
export const itemRef = (item: HomeItem): HomeItemRef => ({ kind: item.kind, id: item.id }) as HomeItemRef;

/**
 * Everything the reader may open, in the square's order: the applications in rail order (section by section, as the
 * rail lists them), then the enabled agents in the order the agent list gives them.
 */
export function homeItems(applications: readonly PlatformAppDeclaration[], agents: readonly AgentHostAgent[]): HomeItem[] {
  const shown = applications.filter((app) => app.id !== HOME_APPLICATION_ID);
  const sections = (["top", "apps", "bottom"] as const).flatMap((rail) => shown.filter((app) => (app.rail ?? "apps") === rail));
  return [
    ...sections.map((app): HomeItem => ({
      kind: "application",
      id: app.id,
      label: app.label,
      description: app.description ?? null,
      icon: app.icon,
      category: app.category,
    })),
    ...agents
      .filter((agent) => agent.enabled)
      .map((agent): HomeItem => ({
        kind: "agent",
        id: agent.id,
        label: agent.name,
        description: agent.description || null,
        icon: "agents",
        category: "agents",
      })),
  ];
}

/** The references that are still open to the reader, in the order given; the rest are simply not shown. */
export function itemsOf(refs: readonly Pick<HomeItemRef, "kind" | "id">[], items: readonly HomeItem[]): HomeItem[] {
  const byKey = new Map(items.map((item) => [itemKey(item), item]));
  return refs.flatMap((ref) => byKey.get(itemKey(ref)) ?? []);
}

/** How many recently opened applications the home lists. */
const RECENT_APPLICATIONS = 8;

/** The applications the reader opened most recently, newest first. */
export function recentApplications(state: HomeState, items: readonly HomeItem[]): HomeItem[] {
  const opened = [...state.recentApplications]
    .sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt) || a.applicationId.localeCompare(b.applicationId))
    .map((entry) => ({ kind: "application" as const, id: entry.applicationId }));
  return itemsOf(opened, items).slice(0, RECENT_APPLICATIONS);
}

/** One of the reader's latest conversations, with the agent it ran on. */
export type RecentConversation = HomeState["recentConversations"][number] & { agent: HomeItem };

/** The reader's latest conversations whose agent is still open to them, in the order given (newest first). */
export function recentConversations(state: HomeState, items: readonly HomeItem[]): RecentConversation[] {
  const agents = new Map(items.filter((item) => item.kind === "agent").map((item) => [item.id, item]));
  return state.recentConversations.flatMap((conversation) => {
    const agent = agents.get(conversation.agentId);
    return agent ? [{ ...conversation, agent }] : [];
  });
}

/** Whether an item's shown name or description holds the search text, ignoring case. */
export function matches(item: HomeItem, query: string): boolean {
  const text = query.trim().toLocaleLowerCase();
  return !text || `${item.label}\n${item.description ?? ""}`.toLocaleLowerCase().includes(text);
}

/** The list with one entry moved to another position. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}
