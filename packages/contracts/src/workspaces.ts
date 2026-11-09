import { z } from "zod";

export const workspaceIdSchema = z.string().uuid();
export const workspaceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const workspacePathSchema = z.string().min(1).refine(value =>
  !value.includes("\\") && !value.includes("\0") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "Invalid source path");
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export const workspaceFileSchema = z.object({ path: workspacePathSchema, content: z.string(), encoding: z.enum(["utf8", "base64"]) }).strict();
export const workspaceImportSchema = z.object({ files: z.array(workspaceFileSchema), message: z.string().trim().min(1).max(200) }).strict();
export const workspaceRestoreSchema = z.object({ commit: workspaceCommitSchema }).strict();
export const workspaceReadSchema = z.object({ commit: workspaceCommitSchema.optional() }).strict();
export const workspaceContentSchema = workspaceReadSchema.extend({ path: workspacePathSchema });
export const workspaceDiffSchema = z.object({ from: workspaceCommitSchema, to: z.union([workspaceCommitSchema, z.literal("working")]) }).strict();
export const workspacePageSchema = z.object({ offset: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
export const workspaceSchema = z.object({
  id: workspaceIdSchema, name: z.string(), headCommit: workspaceCommitSchema,
  activeRunId: workspaceIdSchema.nullable(), createdAt: z.string(), updatedAt: z.string(),
}).strict();
export const workspaceExportSchema = z.object({ commit: workspaceCommitSchema, files: z.array(workspaceFileSchema) }).strict();
export const hostedPublishSchema = z.object({ commit: workspaceCommitSchema, declaration: z.record(z.unknown()) }).strict();
export const hostedRollbackSchema = z.object({ releaseId: workspaceIdSchema, declaration: z.record(z.unknown()) }).strict();
export const hostedAppIdSchema = z.string().regex(/^app-[a-zA-Z0-9-]+$/);
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export const WORKSPACE_FILE_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_TOTAL_BYTES = 20 * 1024 * 1024;

export interface WorkspacePage { items: Workspace[] }
export interface WorkspaceTree { files: Array<{ path: string; size: number }> }
export interface WorkspaceCommit { id: string; parentIds: string[]; createdAt: string; message: string }
export interface WorkspaceCommitPage { items: WorkspaceCommit[] }
export interface WorkspaceDiff { patch: string }
export interface WorkspaceSaved { commit: string }
export interface WorkspacePreviewToken { token: string; expiresAt: string }
export interface HostedPublication { appId: string; releaseId: string; commit: string }
export interface HostedRelease extends HostedPublication { createdAt: string }
export interface HostedReleasePage { items: HostedRelease[] }
