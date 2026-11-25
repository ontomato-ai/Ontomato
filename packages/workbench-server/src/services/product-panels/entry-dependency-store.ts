import type { EntryDependency, EntryDependencyChangeRequest } from "@ontomato/contracts/entry-dependencies";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import type { CurrentProductKind } from "../../infrastructure/product-current";
import { dependencyKey, entryDependencyCompiler } from "./entry-dependency-compiler";

const table = () => t("product_panel_entry_dependencies");
type QueryClient = Pick<PoolClient, "query">;
export type DependencyMap = Map<string, EntryDependency[]>;
type Change = { panelId: string; before: EntryDependency[]; after: EntryDependency[] };
export type EntryDependencyPublication = {
  source: Omit<EntryDependencyChangeRequest["source"], "sequence"> & { id: string };
  panels: Change[];
  detail?: { before: string | null; after: string | null };
};

export function sameDependencies(before: EntryDependency[], after: EntryDependency[]): boolean {
  return before.length === after.length && before.every((item, index) => dependencyKey(item) === dependencyKey(after[index]));
}

async function saveDependencies(client: QueryClient, domainId: string, panelId: string, dependencies: EntryDependency[]) {
  await client.query(`INSERT INTO ${table()} (domain_id,panel_id,dependencies) VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (domain_id,panel_id) DO UPDATE SET dependencies=EXCLUDED.dependencies`,
  [domainId, panelId, JSON.stringify(dependencies)]);
}

export async function readPanelDependencies(client: QueryClient, domainId: string, panelIds: string[]): Promise<DependencyMap> {
  if (!panelIds.length) return new Map();
  const { rows } = await client.query<{ panel_id: string; dependencies: EntryDependency[] }>(
    `SELECT panel_id,dependencies FROM ${table()} WHERE domain_id IN ($1,'') AND panel_id=ANY($2::text[])`, [domainId, panelIds],
  );
  return new Map(rows.map(row => [row.panel_id, row.dependencies]));
}

export async function queueDependencyPublication(client: QueryClient, domainId: string, change: EntryDependencyPublication) {
  await client.query(`INSERT INTO ${t("product_publication_outbox")} (domain_id,dependency_change) VALUES ($1,$2::jsonb)`,
  [domainId, JSON.stringify(change)]);
}

export async function updatePanelDependencies(
  client: PoolClient, domainId: string, actorId: string, kind: CurrentProductKind, id: string,
) {
  const reference = { objectType: kind === "panel" ? "PANEL" : "PROJECTION", objectKey: id };
  const { rows } = await client.query<{ panel_id: string; dependencies: EntryDependency[] }>(
    `SELECT panel_id,dependencies FROM ${table()} WHERE domain_id=$1 AND dependencies @> $2::jsonb`,
    [domainId, JSON.stringify([reference])],
  );
  const previous = new Map(rows.map(row => [row.panel_id, row.dependencies]));
  if (kind === "panel" && !previous.has(id)) previous.set(id, []);
  const compile = entryDependencyCompiler(client, domainId);
  const panels: Change[] = [];
  for (const [panelId, before] of previous) {
    const after = await compile(panelId);
    if (sameDependencies(before, after)) continue;
    await saveDependencies(client, domainId, panelId, after);
    panels.push({ panelId, before, after });
  }
  if (panels.length) await queueDependencyPublication(client, domainId, { source: { kind: "panel", id, actorId }, panels });
}

export async function removePanelDependencies(client: PoolClient, domainId: string, actorId: string, panelId: string) {
  const { rows } = await client.query<{ dependencies: EntryDependency[] }>(
    `DELETE FROM ${table()} WHERE domain_id=$1 AND panel_id=$2 RETURNING dependencies`, [domainId, panelId],
  );
  if (rows.length) await queueDependencyPublication(client, domainId, {
    source: { kind: "panel", id: panelId, actorId },
    panels: [{ panelId, before: rows[0].dependencies, after: [] }],
  });
}

export async function compileRegisteredPanelRoots(client: PoolClient, domainId: string | null, panelIds: Iterable<string>) {
  const compile = entryDependencyCompiler(client, domainId);
  for (const id of panelIds) {
    if (isBuiltinProductId(id) && domainId !== null) continue;
    await saveDependencies(client, domainId ?? "", id, await compile(id));
  }
}

export async function installBuiltinPanelDependencies(client: PoolClient, panelIds: string[]) {
  await compileRegisteredPanelRoots(client, null, panelIds);
  await client.query(`DELETE FROM ${table()} WHERE domain_id='' AND NOT (panel_id=ANY($1::text[]))`, [panelIds]);
}
