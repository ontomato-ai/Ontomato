import {
  matchesDirectPanelValue, panelObjectRefSchema, panelPlacementSchema,
  type PanelMember, type PanelMemberPath, type PanelMemberTarget, type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import {
  productPanelSchema, productProjectionSchema,
  type ApplicationPanelUse, type PanelUseRef, type ProductPanel,
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
import { parseStoredDefinition } from "./definition-diagnostics";
import { findObjectDetailPanelId } from "./object-detail";
import { panelStateKey, type PanelStatePathKey } from "./personal-state-key";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type PanelPathRoot = Pick<ProductPanel, "manifest"> & { id?: string };
type ReadPathSegment = ProductPanelNestedReadRequest["memberPath"][number];
type AnyPathSegment = ReadPathSegment | PanelMemberPath[number];

export interface ResolvedPanelPathStep {
  parentPanel: PanelPathRoot;
  childPanel: ProductPanel;
  member: PanelMember | PanelPlacement;
  selection?: AnyPathSegment["selection"];
}

export interface ResolvePanelMemberPathOptions {
  /** Allow `itemKey` on the final projection segment for row-scoped operations. */
  allowTerminalItemKey?: boolean;
}

function unavailable(): never {
  throw new HttpError(403, "Panel member is unavailable on this path", "PANEL_MEMBER_FORBIDDEN");
}

async function requireTarget(owner: ProductOwner, viewer: AssistantCredentials, target: Target, client?: QueryClient) {
  await requireProductGrant(target.id, "use", viewer);
  const row = await findCurrentProduct(owner.domainId, target.kind, target.id, client);
  if (!row) {
    const kind = target.kind === "panel" ? "Panel" : "Projection";
    throw new HttpError(404, `${kind} '${target.id}' does not exist`, "PRODUCT_UNAVAILABLE");
  }
  return currentProductRecord(row, false);
}

export async function requireRegisteredPanelRoot(
  owner: ProductOwner, viewer: AssistantCredentials, source: PanelUseRef & { kind?: "registered" | "frame" },
  { client, expectedPanelId }: { client?: QueryClient; expectedPanelId?: string } = {},
) {
  const { use, framePanelId } = await requirePanelEntry(viewer, source);
  // The entry owner only returns framePanelId for its panels renderer.
  const id = source.kind === "frame" ? framePanelId : use.panelId;
  if (id === undefined || (expectedPanelId !== undefined && expectedPanelId !== id))
    throw new HttpError(404, "This entry does not use the requested application frame", "PANEL_FRAME_UNAVAILABLE");

  const record = await requireTarget(owner, viewer, { kind: "panel", id }, client);
  return { panel: parseStoredDefinition(productPanelSchema, record, "Panel"), entry: use, framePanelId };
}

async function declaredTarget(
  owner: ProductOwner, panel: PanelPathRoot, target: PanelMemberTarget,
  selection: AnyPathSegment["selection"], entry?: ApplicationPanelUse, client?: QueryClient,
): Promise<Target> {
  if ("fromState" in target) {
    if (!selection || !("stateValue" in selection)) unavailable();
    const { stateValue } = selection;
    const requested = "target" in selection ? selection.target : undefined;
    const { type } = panel.manifest.state[target.fromState];
    if (stateValue === null || !matchesDirectPanelValue(type, stateValue)) unavailable();
    const object = panelObjectRefSchema.parse(stateValue);
    if ("rule" in target.candidates && target.candidates.rule === "objectDetail") {
      if (requested && !("panelId" in requested)) unavailable();
      const panelId = await findObjectDetailPanelId(owner.domainId, object.className, client);
      if (requested && panelId !== requested.panelId) unavailable();
      if (panelId === null)
        throw new HttpError(404, "No detail panel is configured for the selected object's class", "PANEL_MEMBER_UNAVAILABLE");
      return { kind: "panel", id: panelId };
    }
    if (!requested) unavailable();
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
  segment: AnyPathSegment, controlled: string[], client: QueryClient = getPostgresPool(),
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

function pathKey(
  segment: Pick<PanelMemberPath[number], "member" | "itemKey">,
  isFinal: boolean,
  allowTerminalItemKey: boolean,
): PanelStatePathKey {
  if (segment.itemKey !== undefined) {
    if (!allowTerminalItemKey) unavailable();
    if (!isFinal) {
      throw new HttpError(422, "Only the final memberPath segment may carry itemKey", "ROW_OPERATION_MEMBER_INVALID");
    }
  }
  return [segment.member];
}

/** Re-resolve the requested path from an authorized root. A denied member never supplies its definition. */
export function resolvePanelMemberPath<Root extends PanelPathRoot>(
  owner: ProductOwner, viewer: AssistantCredentials, root: Root, memberPath: PanelMemberPath,
  entry?: ApplicationPanelUse, client?: QueryClient, options?: ResolvePanelMemberPathOptions,
) {
  return resolveMemberPath(owner, viewer, root, memberPath, entry, client, options);
}

async function resolveMemberPath<Root extends PanelPathRoot>(
  owner: ProductOwner, viewer: AssistantCredentials, root: Root, memberPath: readonly AnyPathSegment[],
  entry?: ApplicationPanelUse, client?: QueryClient, options?: ResolvePanelMemberPathOptions,
) {
  const allowTerminalItemKey = options?.allowTerminalItemKey === true;
  let panel: Root | ProductPanel = root;
  const ancestors = new Set(root.id === undefined ? [] : [root.id]);
  const keys: PanelStatePathKey[] = [];
  const trail: ResolvedPanelPathStep[] = [];
  let controlled = Object.keys(entry && root.id === entry.panelId ? entry.inputs ?? {} : {});
  for (const [index, segment] of memberPath.entries()) {
    const isFinal = index === memberPath.length - 1;
    const declared = panel.manifest.members[segment.member];
    const placement = segment.member.startsWith("$state.")
      ? await selectedPlacement(owner, root, panel, keys, segment, controlled, client) : undefined;
    if (!declared && !placement) {
      if (panel.id === undefined)
        throw new HttpError(403, `Panel does not declare member '${segment.member}'`, "FORBIDDEN");
      unavailable();
    }
    const member = declared ?? placement!;
    const key = pathKey(segment, isFinal, allowTerminalItemKey);
    if (placement) keys.push([key[0], key[1], placement.id]);
    else keys.push(key);
    const target = await declaredTarget(owner, panel, member.target, placement ? undefined : segment.selection, entry, client);
    if (target.kind === "panel" && ancestors.has(target.id))
      throw new HttpError(409, `Panel member '${segment.member}' forms a cycle`, "PANEL_REFERENCE_CYCLE");
    const record = await requireTarget(owner, viewer, target, client);
    if (target.kind === "projection") {
      if (!isFinal) unavailable();
      return {
        kind: "projection" as const,
        projection: parseStoredDefinition(productProjectionSchema, record, "Projection"),
        panel, member, keys, trail,
      };
    }
    if ("itemKey" in segment && segment.itemKey !== undefined) {
      throw new HttpError(422, "Row itemKey is only allowed on a projection member", "ROW_OPERATION_MEMBER_INVALID");
    }
    ancestors.add(target.id);
    const childPanel = parseStoredDefinition(productPanelSchema, record, "Panel");
    trail.push({ parentPanel: panel, childPanel, member, selection: placement ? undefined : segment.selection });
    panel = childPanel;
    controlled = Object.keys("fromPlatform" in member.target ? entry?.inputs ?? {} : member.inputs ?? {});
  }
  return { kind: "panel" as const, panel, keys, controlled, ancestors, trail };
}

export async function readNestedPanel(
  owner: ProductOwner, credentials: AssistantCredentials, { source, memberPath }: ProductPanelNestedReadRequest,
): Promise<ProductPanelNestedReadResponse> {
  const placement = await (async () => {
    if (source.kind === "candidate") {
      const { loadWorkspacePanel } = await import("../workspaces/panel-candidate");
      const { panel } = await loadWorkspacePanel(owner, credentials, source.workspace);
      return resolveMemberPath(owner, credentials, panel, memberPath);
    }
    const { panel, entry } = await requireRegisteredPanelRoot(owner, credentials, source);
    return resolveMemberPath(owner, credentials, panel, memberPath, entry);
  })();
  if (placement.kind !== "panel" || !("revision" in placement.panel))
    throw new HttpError(404, "The member path does not select a panel", "PANEL_MEMBER_UNAVAILABLE");
  const { id, revision, content, manifest, theme } = placement.panel;
  return { panel: { id, revision, content, manifest, ...(theme !== undefined && { theme }) } };
}
