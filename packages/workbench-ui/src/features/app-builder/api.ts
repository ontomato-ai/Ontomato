import { z } from "zod";
import { agentHostSessionPageSchema } from "@ontomato/contracts/agent-host";
import { appBuilderBootstrapSchema } from "@ontomato/contracts/app-builder";
import {
  workspaceSchema,
  type WorkspaceCommitPage,
  type WorkspaceDiff,
  type WorkspacePreviewToken,
  type WorkspaceSaved,
  type WorkspaceTree,
} from "@ontomato/contracts/workspaces";
import { nodeApiFetch, nodeApiGet, nodeApiPatch, nodeApiPost } from "../../utils/api";
import { createWorkspaceAssistantClient } from "../workbench/assistant-host";

/** Workspaces the column reads at a time, the most the interface returns. */
export const WORKSPACE_PAGE = 100;
/** Commits the history reads at a time. */
export const COMMIT_PAGE = 30;

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`;
const page = (offset: number, limit: number) => new URLSearchParams({ offset: String(offset), limit: String(limit) });
const workspacePageSchema = z.object({ items: z.array(workspaceSchema) });

/** The builder's reads and writes, all on the existing workspace interface (`/api/workspaces`) and its bootstrap. */
export const builderApi = {
  /** The domain's builder agent; its identity comes from the server, never a fixed id. */
  async agent() {
    return appBuilderBootstrapSchema.parse(await nodeApiGet("/app-builder/bootstrap")).agent;
  },
  async workspaces(offset: number) {
    return workspacePageSchema.parse(await nodeApiGet(`/workspaces?${page(offset, WORKSPACE_PAGE)}`)).items;
  },
  async workspace(id: string) {
    return workspaceSchema.parse(await nodeApiGet(workspacePath(id)));
  },
  async create(name: string) {
    return workspaceSchema.parse(await nodeApiPost("/workspaces", { name }));
  },
  async rename(id: string, name: string) {
    return workspaceSchema.parse(await nodeApiPatch(workspacePath(id), { name }));
  },
  async remove(id: string) {
    await nodeApiFetch(workspacePath(id), "DELETE");
  },
  /** The current files, uncommitted ones included. */
  async files(id: string) {
    return ((await nodeApiGet(`${workspacePath(id)}/tree`)) as WorkspaceTree).files;
  },
  async content(id: string, path: string) {
    return (await nodeApiFetch(`${workspacePath(id)}/files/content?${new URLSearchParams({ path })}`, "GET")).text();
  },
  /** Newest first. */
  async commits(id: string, offset: number) {
    return ((await nodeApiGet(`${workspacePath(id)}/commits?${page(offset, COMMIT_PAGE)}`)) as WorkspaceCommitPage).items;
  },
  /** Git's patch from one commit to another, or to the current files (`working`). */
  async diff(id: string, from: string, to: string) {
    return ((await nodeApiGet(`${workspacePath(id)}/diff?${new URLSearchParams({ from, to })}`)) as WorkspaceDiff).patch;
  },
  /** Makes a new commit with an earlier commit's files; returns that new commit. */
  async restore(id: string, commit: string) {
    return ((await nodeApiPost(`${workspacePath(id)}/restore`, { commit })) as WorkspaceSaved).commit;
  },
  async previewToken(id: string) {
    return (await nodeApiPost(`${workspacePath(id)}/preview-token`, {})) as WorkspacePreviewToken;
  },
};

/** The assistant client of one workspace: its conversations are made in it and listed from its own list. */
export function createBuilderClient(workspaceId: string) {
  return createWorkspaceAssistantClient({
    id: workspaceId,
    listSessions: async (cursor) =>
      agentHostSessionPageSchema.parse(
        await nodeApiGet(`${workspacePath(workspaceId)}/sessions${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`),
      ),
  });
}
