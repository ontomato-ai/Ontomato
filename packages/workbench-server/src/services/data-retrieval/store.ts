import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, Pool } from "pg";
import {
  retrievalSnapshotSchema,
  type RetrievalInput,
  type RetrievalSnapshot,
} from "@ontomato/contracts/data-retrieval";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";

export interface RetrievalOwner {
  domainId: string;
  userId: string;
}
export interface Decision {
  id: string;
  runId: string;
  text: string;
  scope: string;
  source: "user";
  supersedesId: string | null;
}
export interface RetrievalRecord {
  owner: RetrievalOwner;
  input: RetrievalInput;
  snapshot: RetrievalSnapshot;
  parentId: string | null;
  decisions: Decision[];
  workSessionId: string;
  currentRunId: string;
  external: boolean;
}
export function fingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const c = await getPostgresPool().connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
function record(row: Record<string, any>): RetrievalRecord {
  return {
    owner: { domainId: row.domain_id, userId: row.owner_id },
    input: row.input,
    snapshot: retrievalSnapshotSchema.parse(row.snapshot),
    parentId: row.parent_id,
    decisions: row.decisions,
    workSessionId: row.work_session_id,
    currentRunId: row.current_run_id,
    external: row.external,
  };
}
export const retrievalStore = {
  async get(
    id: string,
    owner: RetrievalOwner,
    client: Pool | PoolClient = getPostgresPool(),
    lock = false,
  ) {
    const result = await client.query(
      `SELECT * FROM ${table("retrievals")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3${lock ? " FOR UPDATE" : ""}`,
      [id, owner.domainId, owner.userId],
    );
    if (!result.rows[0]) throw new HttpError(404, "Retrieval not found");
    return record(result.rows[0]);
  },
  async create(
    id: string,
    owner: RetrievalOwner,
    input: RetrievalInput,
    parentId: string | null,
    deadline: Date,
    external = false,
  ) {
    return transaction(async (c) => {
      if (parentId) {
        await c.query(
          `INSERT INTO ${table("retrieval_parent_gates")} VALUES($1,$2,$3,false) ON CONFLICT DO NOTHING`,
          [owner.domainId, owner.userId, parentId],
        );
        const gate = await c.query(
          `SELECT closed FROM ${table("retrieval_parent_gates")} WHERE domain_id=$1 AND owner_id=$2 AND parent_id=$3 FOR UPDATE`,
          [owner.domainId, owner.userId, parentId],
        );
        if (gate.rows[0].closed)
          throw new HttpError(409, "Parent run is closed");
      }
      const runId = external ? id : randomUUID(),
        workSessionId = randomUUID(),
        snapshot: RetrievalSnapshot = {
          id,
          revision: 0,
          runtimeSessionId: external ? null : workSessionId,
          runtimeRunId: external ? null : runId,
          run: external
            ? null
            : { status: "running", stopReason: null, errorMessage: null },
          messages: [],
          datasetArtifactIds: [],
          decisionRevision: 0,
        };
      const hash = fingerprint({ input, parentId, external });
      const result = await c.query(
        `INSERT INTO ${table("retrievals")} (id,domain_id,owner_id,parent_id,input,input_hash,snapshot,work_session_id,current_run_id,external) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [
          id,
          owner.domainId,
          owner.userId,
          parentId,
          input,
          hash,
          snapshot,
          workSessionId,
          runId,
          external,
        ],
      );
      if (!result.rowCount) {
        const old = await this.get(id, owner, c);
        if (
          fingerprint({
            input: old.input,
            parentId: old.parentId,
            external: old.external,
          }) !== hash
        )
          throw new HttpError(409, "Retrieval input changed");
        return { record: old, replayed: true };
      }
      await c.query(
        `INSERT INTO ${table("retrieval_rounds")} (id,retrieval_id,request_hash,open,deadline) VALUES($1,$2,$3,true,$4)`,
        [runId, id, hash, deadline],
      );
      return {
        record: {
          owner,
          input,
          snapshot,
          parentId,
          decisions: [],
          workSessionId,
          currentRunId: runId,
          external,
        },
        replayed: false,
      };
    });
  },
  async round(runId: string) {
    const r = await getPostgresPool().query(
      `SELECT * FROM ${table("retrieval_rounds")} WHERE id=$1`,
      [runId],
    );
    if (!r.rows[0]) throw new HttpError(404, "Retrieval round not found");
    return r.rows[0];
  },
  async gate(id: string, owner: RetrievalOwner, runId: string, c: PoolClient) {
    const r = await this.get(id, owner, c, true);
    const round = await c.query(
      `SELECT open,deadline FROM ${table("retrieval_rounds")} WHERE id=$1 AND retrieval_id=$2`,
      [runId, id],
    );
    if (
      r.currentRunId !== runId ||
      !round.rows[0]?.open ||
      new Date(round.rows[0].deadline).getTime() <= Date.now()
    )
      throw Object.assign(new HttpError(409, "Retrieval round is closed"), {
        code: "RETRIEVAL_RUN_CLOSED",
      });
    return r;
  },
  async close(
    id: string,
    owner: RetrievalOwner,
    expectedRunId: string,
    snapshot?: RetrievalSnapshot,
  ) {
    return transaction(async (c) => {
      const r = await this.get(id, owner, c, true);
      await c.query(
        `UPDATE ${table("retrieval_rounds")} SET open=false WHERE id=$1 AND retrieval_id=$2`,
        [expectedRunId, id],
      );
      if (r.currentRunId !== expectedRunId || !snapshot) return r.snapshot;
      await c.query(
        `UPDATE ${table("retrievals")} SET snapshot=$2 WHERE id=$1`,
        [id, snapshot],
      );
      return snapshot;
    });
  },
  async cancelParent(parentId: string, owner: RetrievalOwner) {
    return transaction(async (c) => {
      await c.query(
        `INSERT INTO ${table("retrieval_parent_gates")} VALUES($1,$2,$3,true) ON CONFLICT(domain_id,owner_id,parent_id) DO UPDATE SET closed=true`,
        [owner.domainId, owner.userId, parentId],
      );
      const rows = await c.query(
        `SELECT id FROM ${table("retrievals")} WHERE parent_id=$1 AND domain_id=$2 AND owner_id=$3`,
        [parentId, owner.domainId, owner.userId],
      );
      return rows.rows.map((r) => r.id as string);
    });
  },
};
