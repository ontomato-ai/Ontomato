import { computed, reactive, ref, shallowReactive, watch } from "vue";
import { z } from "zod";
import type { AgentNav } from "@ontomato/agent-shell-ui";
import type { AgentHostSession } from "@ontomato/contracts/agent-host";
import type { Workspace } from "@ontomato/contracts/workspaces";
import { builderApi } from "./api";
import type { LoadState } from "./workspace-view";

/** Conversations an expanded workspace shows at first, and how many more each "more" shows. */
const SHOWN = 5;
const EXPANDED_KEY = "ontomato.appBuilder.expandedWorkspaces";

/** One expanded workspace in the column: the conversations it shows, and whether it has more to show. */
export interface WorkspaceSessions {
  sessions: readonly AgentHostSession[];
  state: LoadState;
  /** Read but not shown yet, or another page on the server. */
  more: boolean;
}

/** What a workspace other than the open one lists, as read when it was expanded or left. */
interface Snapshot {
  sessions: AgentHostSession[];
  nextCursor: string | null;
  state: LoadState;
}

/** The workspaces expanded in this browser; null when nothing readable is kept. */
function readExpanded(): string[] | null {
  try {
    const stored = localStorage.getItem(EXPANDED_KEY);
    return stored === null ? null : z.array(z.string()).parse(JSON.parse(stored));
  } catch {
    return null;
  }
}

function rememberExpanded(ids: readonly string[]) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(ids));
  } catch {
    // Remembering what is expanded is a convenience only.
  }
}

/**
 * The column's conversations, by workspace: which workspaces are expanded (kept in this browser) and what each expanded
 * one lists. The open workspace lists the nav's own conversations, which sending, renaming and run states keep current;
 * any other expanded workspace lists a snapshot, read when it is expanded and never polled. Entering a workspace drops
 * its snapshot and the nav reads it afresh with nothing of the workspace left behind; the workspace left, if still
 * expanded, is read again, so a conversation just made there stays under it. The two lists are never synchronised.
 *
 * Each workspace shows its first five conversations and five more on each "more", reading the next page only when what
 * was read runs out; only what is shown is cut, never the nav's list.
 */
export function useColumnSessions(options: {
  nav: AgentNav;
  workspaceId: () => string | null;
  workspaces: () => readonly Workspace[];
}) {
  const { nav, workspaceId } = options;
  /** The expanded workspaces; null while nothing readable is kept and no workspace has opened yet. */
  const chosen = ref<readonly string[] | null>(readExpanded());
  const expandedIds = computed(() => chosen.value ?? []);
  const snapshots = shallowReactive(new Map<string, Snapshot>());
  const shown = reactive(new Map<string, number>());

  async function readSnapshot(id: string, more: boolean) {
    const snapshot = more ? snapshots.get(id)! : reactive<Snapshot>({ sessions: [], nextCursor: null, state: "loading" });
    snapshots.set(id, snapshot);
    snapshot.state = "loading";
    try {
      const page = await builderApi.sessions(id, more ? snapshot.nextCursor : null);
      // Entered or read again meanwhile: this read no longer is the workspace's list.
      if (snapshots.get(id) !== snapshot) return;
      snapshot.sessions = more ? [...snapshot.sessions, ...page.sessions] : page.sessions;
      snapshot.nextCursor = page.nextCursor;
      snapshot.state = "ready";
    } catch {
      if (snapshots.get(id) === snapshot) snapshot.state = "error";
    }
  }

  /** Where a workspace's conversations come from: the nav for the open one, its snapshot for any other. */
  function source(id: string) {
    if (id === workspaceId()) {
      return {
        sessions: nav.sessions.value,
        nextCursor: nav.nextCursor.value,
        state: nav.sessionsState.value,
        read: (more: boolean) => nav.loadSessions(more),
      };
    }
    const snapshot = snapshots.get(id);
    return {
      sessions: snapshot?.sessions ?? [],
      nextCursor: snapshot?.nextCursor ?? null,
      state: snapshot?.state ?? "loading",
      read: (more: boolean) => readSnapshot(id, more),
    };
  }

  const expanded = computed<ReadonlyMap<string, WorkspaceSessions>>(() => {
    const lists = new Map<string, WorkspaceSessions>();
    for (const id of expandedIds.value) {
      const { sessions, nextCursor, state } = source(id);
      const count = shown.get(id) ?? SHOWN;
      lists.set(id, { sessions: sessions.slice(0, count), state, more: sessions.length > count || nextCursor !== null });
    }
    return lists;
  });

  // The nav lists the open workspace: what it listed of the one left goes before the new one is read.
  watch(
    workspaceId,
    (id) => {
      nav.sessions.value = [];
      nav.nextCursor.value = null;
      if (!id) return;
      // Nothing readable kept in this browser: the workspace opened first is the one expanded.
      if (chosen.value === null) chosen.value = [id];
      snapshots.delete(id);
      void nav.loadSessions();
    },
    { immediate: true },
  );
  // Every other expanded workspace the column lists is read once it has no snapshot: expanded, or just left.
  watch(
    () =>
      options
        .workspaces()
        .filter((item) => item.id !== workspaceId() && expandedIds.value.includes(item.id) && !snapshots.has(item.id)),
    (unread) => {
      for (const item of unread) void readSnapshot(item.id, false);
    },
    { immediate: true },
  );

  function setExpanded(ids: readonly string[]) {
    chosen.value = ids;
    rememberExpanded(ids);
  }

  return {
    expanded,
    toggle(id: string) {
      const ids = expandedIds.value;
      setExpanded(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
    },
    /** Opening a workspace expands it. */
    expand(id: string) {
      if (!expandedIds.value.includes(id)) setExpanded([...expandedIds.value, id]);
    },
    /** A deleted workspace leaves the column's state. */
    forget(id: string) {
      if (expandedIds.value.includes(id)) setExpanded(expandedIds.value.filter((item) => item !== id));
      snapshots.delete(id);
      shown.delete(id);
    },
    /** Shows five more, reading the next page when what was read runs out. */
    more(id: string) {
      const count = (shown.get(id) ?? SHOWN) + SHOWN;
      shown.set(id, count);
      const { sessions, nextCursor, read } = source(id);
      if (sessions.length < count && nextCursor !== null) void read(true);
    },
    retry(id: string) {
      void source(id).read(false);
    },
  };
}
