import { chmod } from "node:fs/promises";
import path from "node:path";
import { openSessionSandbox } from "./sandbox/launch";
import type { SessionEngineSandboxFactory } from "./session-engines";
import { digest, type RuntimeStore, type Scope } from "./store";
import { allocateUid, assertWorkerPolicy } from "./worker";
import { workspaceDirectory } from "./workspaces";

export function sessionSandboxDirectory(root: string, scope: Scope, sessionId: string) {
  return path.join(root, "sessions", digest([scope, sessionId]));
}

export function createSessionEngineSandboxFactory(store: RuntimeStore, root: string): SessionEngineSandboxFactory {
  return async ({ scope, sessionId, sessionDirectory, workspaceId, skills, gatewayUrl, callback, limits }) => {
    assertWorkerPolicy({ development: false });
    const uid = await store.transaction(async client => {
      const { rows: [row] } = await client.query(
        `SELECT s.worker_uid, w.worker_uid AS project_uid
         FROM ${store.table("sessions")} s
         LEFT JOIN ${store.table("workspaces")} w
           ON (w.host_id,w.domain_id,w.id)=(s.host_id,s.domain_id,s.workspace_id)
         WHERE s.host_id=$1 AND s.domain_id=$2 AND s.id=$3 FOR UPDATE OF s`,
        [scope.hostId, scope.domainId, sessionId],
      );
      // A project keeps its existing owner across the sessions that mount its tree.
      const assigned = Number(row.project_uid ?? row.worker_uid) || await allocateUid(path.join(root, "worker-next-uid"));
      if (Number(row.worker_uid) !== assigned)
        await client.query(
          `UPDATE ${store.table("sessions")} SET worker_uid=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
          [scope.hostId, scope.domainId, sessionId, assigned],
        );
      return assigned;
    });
    const gateway = new URL(gatewayUrl);
    const sandbox = await openSessionSandbox({
      uid, sessionDirectory, skills,
      projectTree: workspaceId ? path.join(workspaceDirectory(root, scope, workspaceId), "tree") : undefined,
      endpoints: { gateway: { host: gateway.hostname, port: Number(gateway.port) }, callback },
      processCount: limits.processCount,
      fileBytes: limits.fileBytes,
    });
    try {
      await chmod(path.dirname(sessionDirectory), 0o711);
      await chmod(sessionDirectory, 0o711);
      return sandbox;
    } catch (error) {
      await sandbox.stop();
      throw error;
    }
  };
}

export { destroySessionSandbox, openSessionSandbox } from "./sandbox/launch";
export type { OpenSessionSandbox, SessionSandboxOptions } from "./sandbox/launch";
