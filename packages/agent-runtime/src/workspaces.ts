import { randomUUID } from "node:crypto";
import { mkdir, chmod, rm } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { WorkspaceFile } from "@ontomato/contracts/workspaces";
import { RuntimeStore, digest, type Scope } from "./store";
import { allocateUid, type WorkerPolicy } from "./worker";
import { RuntimeError, missing } from "./errors";
import { WorkspaceGit } from "./workspace-git";
export class Workspaces {
  constructor(private store: RuntimeStore, private root: string, private policy: WorkerPolicy) {}
  git(scope: Scope, id: string) { return new WorkspaceGit(path.join(this.root, "workspaces", digest([scope, id]))); }
  async row(scope: Scope, owner: string, id: string, c: pg.Pool | pg.PoolClient = this.store.pool, lock = false) {
    const row = (await c.query(`SELECT * FROM ${this.store.table("workspaces")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND owner_id=$4${lock ? " FOR UPDATE NOWAIT" : ""}`, [scope.hostId, scope.domainId, id, owner])).rows[0];
    if (!row) missing();
    return row;
  }
  async view(scope: Scope, row: Record<string, any>) {
    return { id: row.id, name: row.name, activeRunId: row.active_run_id,
      headCommit: await this.git(scope, row.id).head(), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }
  async get(scope: Scope, owner: string, id: string) { return this.view(scope, await this.row(scope, owner, id)); }
  async list(scope: Scope, owner: string, offset: number, limit: number) {
    const rows = (await this.store.pool.query(`SELECT * FROM ${this.store.table("workspaces")} WHERE host_id=$1 AND domain_id=$2 AND owner_id=$3 ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5`, [scope.hostId, scope.domainId, owner, limit, offset])).rows;
    return { items: await Promise.all(rows.map(row => this.view(scope, row))) };
  }
  async create(scope: Scope, owner: string, name: string) {
    const id = randomUUID();
    await mkdir(path.join(this.root, "workspaces"), { recursive: true, mode: 0o711 });
    await chmod(path.join(this.root, "workspaces"), 0o711);
    const uid = this.policy.development ? 0 : await allocateUid(this.policy.uidStatePath!);
    const git = this.git(scope, id);
    await git.initialize();
    if (!this.policy.development) await git.own(uid);
    await this.store.pool.query(`INSERT INTO ${this.store.table("workspaces")} (host_id,domain_id,id,owner_id,name,worker_uid) VALUES($1,$2,$3,$4,$5,$6)`, [scope.hostId, scope.domainId, id, owner, name, uid]);
    return this.get(scope, owner, id);
  }
  async rename(scope: Scope, owner: string, id: string, name: string) {
    await this.row(scope, owner, id);
    await this.store.pool.query(`UPDATE ${this.store.table("workspaces")} SET name=$4,updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [scope.hostId, scope.domainId, id, name]);
    return this.get(scope, owner, id);
  }
  async write<T>(scope: Scope, owner: string, id: string, fn: (git: WorkspaceGit, uid: number) => Promise<T>) {
    return this.store.transaction(async c => {
      const row = await this.row(scope, owner, id, c, true);
      if (row.active_run_id) throw new RuntimeError(409, "WORKSPACE_BUSY", "Workspace has an active run");
      const result = await fn(this.git(scope, id), Number(row.worker_uid));
      await c.query(`UPDATE ${this.store.table("workspaces")} SET updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [scope.hostId, scope.domainId, id]);
      return result;
    });
  }
  async replace(scope: Scope, owner: string, id: string, files: WorkspaceFile[]) {
    return this.write(scope, owner, id, async (git, uid) => {
      await git.replace(files, this.policy.development ? undefined : uid);
      return { commit: await git.commit("Import source tree") };
    });
  }
  async restore(scope: Scope, owner: string, id: string, commit: string) {
    return this.write(scope, owner, id, async (git, uid) => {
      await git.replace((await git.export(commit)).files, this.policy.development ? undefined : uid);
      return { commit: await git.commit(`Restore ${commit}`) };
    });
  }
  async delete(scope: Scope, owner: string, id: string, deleteSession: (id: string) => Promise<void>) {
    return this.store.transaction(async c => {
      const row = await this.row(scope, owner, id, c, true);
      if (row.active_run_id) throw new RuntimeError(409, "WORKSPACE_BUSY", "Workspace has an active run");
      const sessions = (await c.query(`SELECT id FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND workspace_id=$3`, [scope.hostId, scope.domainId, id])).rows;
      for (const session of sessions) await deleteSession(session.id);
      await c.query(`DELETE FROM ${this.store.table("workspaces")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [scope.hostId, scope.domainId, id]);
      await rm(this.git(scope, id).directory, { recursive: true });
      return { sessionIds: sessions.map(s => s.id as string) };
    });
  }
  async saveSession(scope: Scope, sessionId: string, runId: string) {
    const session = await this.store.session(scope, sessionId);
    if (session.workspaceId) await this.git(scope, session.workspaceId).commit(`Save run ${runId}`);
  }
  async recover() {
    const rows = (await this.store.pool.query(`SELECT * FROM ${this.store.table("workspaces")} WHERE active_run_id IS NULL`)).rows;
    for (const row of rows) await this.git({ hostId: row.host_id, domainId: row.domain_id }, row.id).commit("Save changes after runtime restart");
  }
}
