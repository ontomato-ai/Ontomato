import { runtimeJsonValueSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelPersonalStateReadRequest, PanelPersonalStateWriteRequest } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelPlacementSchema, type PanelStateField } from "@ontomato/contracts/panel-manifest";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { requireRegisteredPanelRoot, resolvePanelMemberPath } from "./member-path";
import { panelStateKey } from "./personal-state-key";
import { validatePersonalPlacement } from "./references";

async function personalFields(
  owner: ProductOwner, viewer: AssistantCredentials, request: PanelPersonalStateReadRequest | PanelPersonalStateWriteRequest,
  names: string[], client?: PoolClient,
) {
  const { panel: root, entry } = await requireRegisteredPanelRoot(owner, viewer, request.source, { client });
  const scope = await resolvePanelMemberPath(owner, viewer, root, request.memberPath, entry, client);
  if (scope.kind !== "panel")
    throw new HttpError(400, "Personal state belongs to a panel instance", "PANEL_PERSONAL_FIELD_INVALID");

  const fields = names.map(name => {
    const field = scope.panel.manifest.state[name];
    if (!field?.personal)
      throw new HttpError(400, `State '${name}' is not declared personal`, "PANEL_PERSONAL_FIELD_INVALID");
    if (scope.controlled.includes(name))
      throw new HttpError(400, `State '${name}' is set by the outer panel`, "PANEL_STATE_CONTROLLED");
    const key = panelStateKey(owner.domainId, root.id, scope.keys, scope.panel.id, name);
    return { name, key, field };
  });
  return { panel: scope.panel, ancestors: scope.ancestors, fields };
}

function requireStateValue(name: string, field: PanelStateField, value: RuntimeJsonValue) {
  if (!matchesDirectPanelValue(field.type, value))
    throw new HttpError(400, `Value does not match personal state '${name}'`, "PANEL_PERSONAL_VALUE_INVALID");
  return value;
}

export async function readPanelPersonalState(
  owner: ProductOwner, viewer: AssistantCredentials, request: PanelPersonalStateReadRequest,
) {
  const { fields } = await personalFields(owner, viewer, request, request.fields);
  const { rows } = await getPostgresPool().query<{ key: string; value: unknown }>(
    `SELECT key,value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=ANY($2::text[])`,
    [owner.userId, fields.map(({ key }) => key)],
  );
  const saved = new Map(rows.map(({ key, value }) => [key, value]));
  const values = Object.fromEntries(fields.flatMap(({ name, key, field }) => saved.has(key)
    ? [[name, requireStateValue(name, field, runtimeJsonValueSchema.parse(saved.get(key)))]] : []));
  return { values };
}

export async function writePanelPersonalState(
  owner: ProductOwner, viewer: AssistantCredentials, request: PanelPersonalStateWriteRequest,
) {
  return transaction(async client => {
    await lockProducts(client, owner);
    const { panel, ancestors, fields } = await personalFields(owner, viewer, request, Object.keys(request.values), client);
    const values = fields.map(({ name, field }) => ({ name, field, value: requireStateValue(name, field, request.values[name]) }));
    for (const { name, field, value } of values) {
      if (field.type.kind === "placement" && value !== null)
        await validatePersonalPlacement(owner, viewer, panel, ancestors, name, panelPlacementSchema.parse(value), client);
    }
    if (fields.length) {
      await client.query(
        `INSERT INTO ${qualifiedTable("user_preferences")} (user_id,key,value)
         SELECT $1,key,value::jsonb FROM unnest($2::text[],$3::text[]) AS state(key,value)
         ON CONFLICT (user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
        [owner.userId, fields.map(({ key }) => key), values.map(({ value }) => JSON.stringify(value))],
      );
    }
    return { values: request.values };
  });
}
