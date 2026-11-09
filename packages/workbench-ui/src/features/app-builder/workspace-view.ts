import { reactive, watch } from "vue";
import type { Workspace, WorkspaceCommit, WorkspaceTree } from "@ontomato/contracts/workspaces";
import { builderApi, COMMIT_PAGE } from "./api";
import { errorText } from "./panel";

export type LoadState = "loading" | "ready" | "error";
export type WorkspaceFileEntry = WorkspaceTree["files"][number];

/**
 * What the builder shows of the open workspace: its facts (name, HEAD, the run that occupies it), its current files and
 * its commits. The files and commits follow the workspace's HEAD, so a run's commit or a restore re-reads them once.
 * A read still on its way for a workspace already left is dropped.
 */
export function useWorkspaceView(workspaceId: () => string | null) {
  let factsRead = 0;
  let filesRead = 0;
  let commitsRead = 0;
  const view = reactive({
    workspace: null as Workspace | null,
    error: null as string | null,
    files: [] as WorkspaceFileEntry[],
    filesState: "loading" as LoadState,
    commits: [] as WorkspaceCommit[],
    commitsState: "loading" as LoadState,
    moreCommits: false,

    /** Reads the facts again: when the workspace opens, when a run starts or stops, after a restore. */
    async refresh() {
      const id = workspaceId();
      if (!id) return;
      const read = ++factsRead;
      try {
        const workspace = await builderApi.workspace(id);
        if (read !== factsRead) return;
        view.workspace = workspace;
        view.error = null;
      } catch (error) {
        if (read === factsRead) view.error = errorText(error);
      }
    },

    async loadFiles() {
      const id = view.workspace!.id;
      const read = ++filesRead;
      view.filesState = "loading";
      try {
        const files = await builderApi.files(id);
        if (read !== filesRead) return;
        view.files = files;
        view.filesState = "ready";
      } catch {
        if (read === filesRead) view.filesState = "error";
      }
    },

    async loadCommits(more = false) {
      const id = view.workspace!.id;
      const read = ++commitsRead;
      view.commitsState = "loading";
      try {
        const items = await builderApi.commits(id, more ? view.commits.length : 0);
        if (read !== commitsRead) return;
        view.commits = more ? [...view.commits, ...items] : items;
        view.moreCommits = items.length === COMMIT_PAGE;
        view.commitsState = "ready";
      } catch {
        if (read === commitsRead) view.commitsState = "error";
      }
    },

    /** Makes a new commit with an earlier commit's files and returns it; the facts, files and history follow. */
    async restore(commit: string) {
      const created = await builderApi.restore(workspaceId()!, commit);
      await view.refresh();
      return created;
    },
  });

  watch(
    workspaceId,
    () => {
      factsRead++;
      filesRead++;
      commitsRead++;
      Object.assign(view, {
        workspace: null, error: null, files: [], filesState: "loading", commits: [], commitsState: "loading", moreCommits: false,
      });
      void view.refresh();
    },
    { immediate: true },
  );
  watch(
    () => view.workspace && `${view.workspace.id}:${view.workspace.headCommit}`,
    (key) => {
      if (!key) return;
      void view.loadFiles();
      void view.loadCommits();
    },
  );
  return view;
}

export type WorkspaceView = ReturnType<typeof useWorkspaceView>;
