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
import { PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { ProductPanelNestedReadRequest, ProductPanelNestedReadResponse } from "@ontomato/contracts/panel-host";
import { HttpError } from "../../utils/errors";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { requirePanelEntry } from "./application-use";
import { findObjectDetailPanelId } from "./object-detail";
import { panelStateKey, type PanelStatePathKey } from "./personal-state-key";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type PanelPathRoot = Pick<ProductPanel, "manifest"> & { id?: string };

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
  owner: ProductOwner, panel: PanelPathRoot, target: PanelMemberTarget,
  selection: PanelMemberPath[number]["selection"], entry?: ApplicationPanelUse, client?: QueryClient,
): Promise<Target> {
  if ("fromState" in target) {
    if (!selection || !("stateValue" in selection)) unavailable();
    const { stateValue, target: requested } = selection;
    const { type } = panel.manifest.state[target.fromState];
    if (stateValue === null || !matchesDirectPanelValue(type, stateValue)) unavailable();
    const object = panelObjectRefSchema.parse(stateValue);
    if ("rule" in target.candidates && target.candidates.rule === "objectDetail") {
      if (!("panelId" in requested)) unavailable();
      const panelId = await findObjectDetailPanelId(owner.domainId, object.className, client);
      if (panelId !== requested.panelId) unavailable();
      return { kind: "panel", id: requested.panelId };
    }
    const kind = "panelId" in requested ? "panel" : "projection";
    const id = "panelId" in requested ? requested.panelId : requested.projectionId;
    if (object.className !== (kind === "panel" ? PRODUCT_PANEL : PRODUCT_PROJECTION) || object.primaryKey !== id) unavailable();
    const allowed = "panelIds" in target.candidates
      ? kind === "panel" && target.candidates.panelIds.includes(id)
      : "projectionIds" in target.candidates
        ? kind === "projection" && target.candidates.projectionIds.includes(id)
        : target.candidates.rule === "usable";
    if (!allowed) throw new HttpError(404, "The selected product is outside this member's candidates", "PANEL_MEMBER_UNAVAILABLE");
    return { kind, id };
  }
  if (selection) unavailable();
  if ("panelId" in target) return { kind: "panel", id: target.panelId };
  if ("projectionId" in target) return { kind: "projection", id: target.projectionId };
  if (!entry) unavailable();
  return { kind: "panel", id: entry.panelId };
}

async function selectedPlacement(
  owner: ProductOwner, root: PanelPathRoot, panel: PanelPathRoot, keys: PanelStatePathKey[],
  segment: PanelMemberPath[number], controlled: string[], client: QueryClient = getPostgresPool(),
): Promise<PanelPlacement> {
  const name = segment.member.slice("$state.".length);
  const field = panel.manifest.state[name];
  if (controlled.includes(name)) unavailable();
  const selection = segment.selection;
  if (!field || field.type.kind !== "placement" || !selection || !("placement" in selection)) unavailable();
  let value = field.default;
  if (field.personal && root.id !== undefined && panel.id !== undefined) {
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
export async function resolvePanelMemberPath<Root extends PanelPathRoot>(
  owner: ProductOwner, viewer: AssistantCredentials, root: Root, memberPath: PanelMemberPath,
  entry?: ApplicationPanelUse, client?: QueryClient,
) {
  let panel: Root | ProductPanel = root;
  const ancestors = new Set(root.id === undefined ? [] : [root.id]);
  const keys: PanelStatePathKey[] = [];
  let controlled = Object.keys(entry && root.id === entry.panelId ? entry.inputs ?? {} : {});
  for (const [index, segment] of memberPath.entries()) {
    const declared = panel.manifest.members[segment.member];
    const placement = segment.member.startsWith("$state.")
      ? await selectedPlacement(owner, root, panel, keys, segment, controlled, client) : undefined;
    if (!declared && !placement) {
      if (panel.id === undefined)
        throw new HttpError(403, `Panel does not declare member '${segment.member}'`, "FORBIDDEN");
      unavailable();
    }
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

export async function readNestedPanel(
  owner: ProductOwner, credentials: AssistantCredentials, { source, memberPath }: ProductPanelNestedReadRequest,
): Promise<ProductPanelNestedReadResponse> {
  const placement = await (async () => {
    if (source.kind === "candidate") {
      const { resolvePanelCandidatePlacement } = await import("../workspaces/panel-candidate");
      return (await resolvePanelCandidatePlacement(owner, credentials, source.workspace, memberPath)).placement;
    }
    const { panel, entry } = await requireRegisteredPanelRoot(owner, credentials, source);
    return resolvePanelMemberPath(owner, credentials, panel, memberPath, entry);
  })();
  if (placement.kind !== "panel" || !("revision" in placement.panel))
    throw new HttpError(404, "The member path does not select a panel", "PANEL_MEMBER_UNAVAILABLE");
  const { id, revision, content, manifest } = placement.panel;
  return { panel: { id, revision, content, manifest } };
}
