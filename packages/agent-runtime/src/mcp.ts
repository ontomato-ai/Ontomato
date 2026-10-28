import { randomUUID } from "node:crypto";
import {
  MCP_HEADER_MASK,
  mcpServiceWriteSchema,
  type McpServiceView,
  type McpServiceOption,
  type McpServiceWrite,
} from "@ontomato/contracts/agent-runtime-mcp";
import { RuntimeStore, type Scope } from "./store";
import { RuntimeError, missing } from "./errors";
import { discoverMcp, type McpConnection } from "./tools";

const scopeValues = (scope: Scope) => [scope.hostId, scope.domainId];
const view = (row: McpConnection): McpServiceView => ({
  id: row.id,
  name: row.name,
  url: row.url,
  headers: Object.fromEntries(
    Object.keys(row.headers).map((name) => [name, MCP_HEADER_MASK]),
  ),
});

function mergeHeaders(
  input: McpServiceWrite["headers"],
  current: Record<string, string>,
) {
  if (input === undefined) return current;
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => {
      if (value === null && !Object.hasOwn(current, name))
        throw new RuntimeError(
          400,
          "INVALID_REQUEST",
          "Cannot retain a missing header",
        );
      return [name, value === null ? current[name] : value];
    }),
  );
}
function conflict(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  )
    throw new RuntimeError(
      409,
      "MCP_NAME_EXISTS",
      "MCP service name already exists",
    );
  throw error;
}

/** Runtime-owned configuration. Plain connection values never leave the service boundary. */
export class RuntimeMcpServices {
  constructor(private readonly store: RuntimeStore) {}
  async options(scope: Scope): Promise<McpServiceOption[]> {
    return (
      await this.store.pool.query(
        `SELECT id,name FROM ${this.store.table("mcp_services")} WHERE host_id=$1 AND domain_id=$2 ORDER BY name,id`,
        scopeValues(scope),
      )
    ).rows;
  }
  async list(scope: Scope): Promise<McpServiceView[]> {
    return (
      await this.store.pool.query(
        `SELECT id,name,url,headers FROM ${this.store.table("mcp_services")} WHERE host_id=$1 AND domain_id=$2 ORDER BY name,id`,
        scopeValues(scope),
      )
    ).rows.map(view);
  }
  async create(scope: Scope, body: unknown): Promise<McpServiceView> {
    const input = mcpServiceWriteSchema.parse(body);
    const headers = mergeHeaders(input.headers, {});
    try {
      const result = await this.store.pool.query(
        `INSERT INTO ${this.store.table("mcp_services")} (host_id,domain_id,id,name,url,headers) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,name,url,headers`,
        [
          ...scopeValues(scope),
          randomUUID(),
          input.name,
          input.url,
          JSON.stringify(headers),
        ],
      );
      return view(result.rows[0]);
    } catch (error) {
      return conflict(error);
    }
  }
  async update(
    scope: Scope,
    id: string,
    body: unknown,
  ): Promise<McpServiceView> {
    const input = mcpServiceWriteSchema.parse(body);
    try {
      return await this.store.transaction(async (c) => {
        const old = (
          await c.query(
            `SELECT headers FROM ${this.store.table("mcp_services")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE`,
            [...scopeValues(scope), id],
          )
        ).rows[0];
        if (!old) missing();
        const result = await c.query(
          `UPDATE ${this.store.table("mcp_services")} SET name=$4,url=$5,headers=$6::jsonb WHERE host_id=$1 AND domain_id=$2 AND id=$3 RETURNING id,name,url,headers`,
          [
            ...scopeValues(scope),
            id,
            input.name,
            input.url,
            JSON.stringify(mergeHeaders(input.headers, old.headers)),
          ],
        );
        return view(result.rows[0]);
      });
    } catch (error) {
      return conflict(error);
    }
  }
  async delete(scope: Scope, id: string): Promise<void> {
    const result = await this.store.pool.query(
      `DELETE FROM ${this.store.table("mcp_services")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [...scopeValues(scope), id],
    );
    if (!result.rowCount) missing();
  }
  async resolve(scope: Scope, ids: string[]): Promise<McpConnection[]> {
    if (!ids.length) return [];
    return (
      await this.store.pool.query(
        `SELECT id,name,url,headers FROM ${this.store.table("mcp_services")} WHERE host_id=$1 AND domain_id=$2 AND id=ANY($3::uuid[]) ORDER BY name,id`,
        [...scopeValues(scope), ids],
      )
    ).rows;
  }
  async discover(
    scope: Scope,
    id: string,
    correlationId: string,
    signal: AbortSignal,
  ) {
    const [config] = await this.resolve(scope, [id]);
    if (!config) missing();
    try {
      return await discoverMcp(config, correlationId, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new RuntimeError(
        502,
        "MCP_DISCOVERY_FAILED",
        "Unable to connect to MCP service",
      );
    }
  }
}
