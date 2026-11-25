import { randomBytes } from "node:crypto";
import type { AssistantOwner } from "../assistant/store";
import { WorkspaceBuildTests } from "../app-builder/build-tests";

export interface HostedPreviewEntry {
  workspaceId: string;
  owner: AssistantOwner;
  workspaceOwnerId?: string;
  expiresAt: number;
}

const previews = new Map<string, HostedPreviewEntry>();

export async function issueHostedPreviewToken(
  owner: AssistantOwner,
  credentials: { token?: string; apiKey?: string; locale?: string; headers?: Record<string, string> },
  workspaceId: string,
  workspaceOwnerId = owner.userId,
) {
  const tests = new WorkspaceBuildTests(owner, credentials, workspaceId, workspaceOwnerId);
  await tests.requirePreviewSdk();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 10 * 60_000;
  previews.set(token, { workspaceId, owner, workspaceOwnerId, expiresAt });
  setTimeout(() => previews.delete(token), 10 * 60_000).unref();
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function lookupHostedPreviewToken(token: string): HostedPreviewEntry | undefined {
  return previews.get(token);
}
