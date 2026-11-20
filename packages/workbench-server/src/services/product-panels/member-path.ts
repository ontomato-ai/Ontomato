import {
  matchesDirectPanelValue, panelObjectRefSchema, panelPlacementSchema, type PanelMemberPath, type PanelMemberTarget, type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import {
  productPanelSchema, productProjectionSchema,
  type ApplicationPanelUse, type ProductPanel,
} from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { currentProductRecord, findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { requirePanelEntry } from "./application-use";
import { findObjectDetailPanelId } from "./object-detail";
import { panelStateKey, type PanelStatePathKey } from "./personal-state-key";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };

function unavailable(): never {
  throw new HttpError(403, "Panel member is unavailable on this path", "PANEL_MEMBER_FORBIDDEN");
}

async function requireTarget(owner: ProductOwner, viewer: AssistantCredentials, target: Target, client?: QueryClient) {
  await requireProductGrant(target.id, "use", viewer);
  const row = await findCurrentProduct(owner.domainId, target.kind, target.id, client);
  if (!row) throw new HttpError(404, "Current member definition not found", "PRODUCT_UNAVAILABLE");
  return currentProductRecord(row, false);
}

export async function requireRegisteredPanelRoot(
  owner: ProductOwner, viewer: AssistantCredentials, source: Parameters<typeof requirePanelEntry>[1], client?: QueryClient,
) {
  const { use } = await requirePanelEntry(viewer, source);
  const panel = productPanelSchema.parse(await requireTarget(owner, viewer, { kind: "panel", id: use.panelId }, client));
  return { panel, entry: use };
}

async function declaredTarget(
  owner: ProductOwner, panel: ProductPanel, target: PanelMemberTarget,
  selection: PanelMemberPath[number]["selection"], entry?: ApplicationPanelUse, client?: QueryClient,
): Promise<Target> {
  if ("fromState" in target) {
    if (!selection || !("stateValue" in selection)) unavailable();
    const { stateValue, target: requested } = selection;
    const { type } = panel.manifest.state[target.fromState];
    if (stateValue === null || !matchesDirectPanelValue(type, stateValue)) unavailable();
    if ("panelIds" in target.candidates) {
      if (stateValue !== requested.panelId || !target.candidates.panelIds.includes(requested.panelId)) unavailable();
    } else {
      const object = panelObjectRefSchema.parse(stateValue);
      const panelId = await findObjectDetailPanelId(owner.domainId, object.className, client);
      if (panelId !== requested.panelId) unavailable();
    }
    return { kind: "panel", id: requested.panelId };
  }
  if (selection) unavailable();
  if ("panelId" in target) return { kind: "panel", id: target.panelId };
  if ("projectionId" in target) return { kind: "projection", id: target.projectionId };
  if (!entry) unavailable();
  return { kind: "panel", id: entry.panelId };
}

async function selectedPlacement(
  owner: ProductOwner, root: ProductPanel, panel: ProductPanel, keys: PanelStatePathKey[],
  segment: PanelMemberPath[number], controlled: string[], client: QueryClient = getPostgresPool(),
): Promise<PanelPlacement> {
  const name = segment.member.slice("$state.".length);
  const field = panel.manifest.state[name];
  if (controlled.includes(name)) unavailable();
  const selection = segment.selection;
  if (!field || field.type.kind !== "placement" || !selection || !("placement" in selection)) unavailable();
  let value = field.default;
  if (field.personal) {
    const key = panelStateKey(owner.domainId, root.id, keys, panel.id, name);
    const { rows } = await client.query<{ value: typeof value }>(
      `SELECT value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=$2`,
      [owner.userId, key],
    );
    if (rows.length) value = rows[0].value;
  }
  if (value == null || !matchesDirectPanelValue(field.type, value)) unavailable();
  const placement = panelPlacementSchema.parse(value);
  const expected = selection.placement;
  if (placement.id !== expected.id ||
    ("panelId" in expected.target
      ? !("panelId" in placement.target) || placement.target.panelId !== expected.target.panelId
      : !("projectionId" in placement.target) || placement.target.projectionId !== expected.target.projectionId))
    unavailable();
  return placement;
}

function pathKey(segment: PanelMemberPath[number]): PanelStatePathKey {
  if (segment.itemKey !== undefined) unavailable();
  return [segment.member];
}

/** Re-resolve the requested path from an authorized root. A denied member never supplies its definition. */
export async function resolvePanelMemberPath(
  owner: ProductOwner, viewer: AssistantCredentials, root: ProductPanel, memberPath: PanelMemberPath,
  entry?: ApplicationPanelUse, client?: QueryClient,
) {
  let panel = root;
  const ancestors = new Set([root.id]);
  const keys: PanelStatePathKey[] = [];
  let controlled = Object.keys(root.id === entry?.panelId ? entry.inputs ?? {} : {});
  for (const [index, segment] of memberPath.entries()) {
    const declared = panel.manifest.members[segment.member];
    const placement = segment.member.startsWith("$state.")
      ? await selectedPlacement(owner, root, panel, keys, segment, controlled, client) : undefined;
    if (!declared && !placement) unavailable();
    const member = declared ?? placement!;
    const key = pathKey(segment);
    if (placement) keys.push([key[0], key[1], placement.id]);
    else keys.push(key);
    const target = await declaredTarget(owner, panel, member.target, placement ? undefined : segment.selection, entry, client);
    if (target.kind === "panel" && ancestors.has(target.id))
      throw new HttpError(409, `Panel member '${segment.member}' forms a cycle`, "PANEL_REFERENCE_CYCLE");
    const record = await requireTarget(owner, viewer, target, client);
    if (target.kind === "projection") {
      if (index !== memberPath.length - 1) unavailable();
      return { kind: "projection" as const, projection: productProjectionSchema.parse(record), panel, member, keys };
    }
    ancestors.add(target.id);
    panel = productPanelSchema.parse(record);
    controlled = Object.keys("fromPlatform" in member.target ? entry?.inputs ?? {} : member.inputs ?? {});
  }
  return { kind: "panel" as const, panel, keys, controlled, ancestors };
}
