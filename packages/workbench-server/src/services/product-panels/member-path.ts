import {
  matchesDirectPanelValue, panelObjectRefSchema, panelPlacementSchema,
  type PanelMember, type PanelMemberPath, type PanelMemberTarget, type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import {
  productPanelSchema,
  productProjectionSchema,
  isApplicationPanelUse, isNativeApplicationEntry,
  type ApplicationEntryResolution, type ApplicationPanelUse, type PanelUseRef, type ProductPanel,
} from "@ontomato/contracts/product-panels";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { ScheduledApplicationsStatus } from "@ontomato/platform-schedules/panel-reads";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import {
  currentProductRecord, findCurrentProduct, findCurrentProducts, type CurrentProductKind, type CurrentProductRow,
} from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { ProductPanelNestedReadRequest, ProductPanelNestedReadResponse } from "@ontomato/contracts/panel-host";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { currentDefinitionAccess, requireCurrentDefinitionUse, type DefinitionKind } from "./access";
import { requireAllowed } from "../product-governance/authorization";
import { readRegisteredPanelEntry, requirePanelEntry, withPanelReadRegistration } from "./application-use";
import { parseStoredDefinition } from "./definition-diagnostics";
import { bundledPanelProjectionIds, panelDefinition } from "./render-definitions";
import { readBundledPanelProjections } from "./bundled-projections";
import { readPanelDomainComponents, readProjectionComponent } from "./component-catalogue";
import { findObjectDetailPanelId } from "./object-detail";
import { panelStateKey, type PanelStatePathKey } from "./personal-state-key";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type CandidateDefinition = (target: Target) => ReturnType<typeof currentProductRecord> | undefined;
type PanelPathRoot = Pick<ProductPanel, "manifest"> & { id?: string };
type ReadPathSegment = ProductPanelNestedReadRequest["memberPath"][number];
type AnyPathSegment = ReadPathSegment | PanelMemberPath[number];
type RegisteredSource = PanelUseRef & { kind?: "registered" | "frame" };
type PanelEntry = Awaited<ReturnType<typeof readRegisteredPanelEntry>>;
/** Return true to defer the USE decision to the registered Java batch. */
export type PanelUseCollector = (kind: DefinitionKind, row: CurrentProductRow) => true | void;

function memoize<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = load();
  cache.set(key, pending);
  return pending;
}

function targetKey({ kind, id }: Target) {
  return `${kind}\0${id}`;
}

export class PanelReadBatchCache {
  private readonly entries = new Map<string, Promise<PanelEntry>>();
  private readonly grants = new Map<string, Promise<void>>();
  private readonly products = new Map<string, Promise<CurrentProductRow | undefined>>();
  private readonly reads = new Map<string, Promise<unknown>>();
  private readonly scheduledApplications = new Map<string | undefined, Promise<ScheduledApplicationsStatus>>();
  private readonly domainId: string;

  private readonly registeredEntry: (source: PanelUseRef) => Promise<PanelEntry>;

  constructor(owner: ProductOwner, private readonly viewer: AssistantCredentials, registeredEntry?: (source: PanelUseRef) => Promise<PanelEntry>) {
    this.domainId = owner.domainId;
    this.registeredEntry = registeredEntry ?? (source => readRegisteredPanelEntry(viewer, source, owner));
  }

  entry(source: PanelUseRef) {
    return memoize(this.entries, `${source.applicationId}\0${source.useId}`, () => this.registeredEntry(source));
  }

  requireUse(target: Target, row: CurrentProductRow) {
    return memoize(this.grants, targetKey(target), () => requireCurrentDefinitionUse(target.kind, row, this.domainId, this.viewer));
  }

  product(target: Target, client?: QueryClient) {
    return memoize(this.products, targetKey(target), () => findCurrentProduct(this.domainId, target.kind, target.id, client));
  }

  read(key: string, load: () => Promise<unknown>) {
    return memoize(this.reads, key, load);
  }

  scheduleApplications(previewHeader: string | undefined, load: () => Promise<ScheduledApplicationsStatus>) {
    return memoize(this.scheduledApplications, previewHeader, load);
  }

  async prefetch(targets: readonly Target[]) {
    const lookups: Promise<unknown>[] = [];
    for (const kind of ["panel", "projection"] as const) {
      const ids = [...new Set(targets.filter(target => target.kind === kind).map(target => target.id))]
        .filter(id => !this.products.has(targetKey({ kind, id })));
      if (ids.length === 0) continue;
      const rows = findCurrentProducts(this.domainId, kind, ids);
      const decisions = rows.then(async products => {
        const available = [...products.values()];
        const { decisions } = await currentDefinitionAccess(kind, available, this.domainId, this.viewer, false);
        return new Map(available.map((row, index) => [row.id, decisions[index]]));
      });
      for (const id of ids) {
        const key = targetKey({ kind, id });
        const row = rows.then(products => products.get(id));
        const admission = decisions.then(admissions => {
          const decision = admissions.get(id);
          if (decision) requireAllowed(decision);
        });
        this.products.set(key, row);
        this.grants.set(key, admission);
        lookups.push(row, admission);
      }
    }
    // Keep rejections in the cache for the reads that need those entries.
    await Promise.allSettled(lookups);
  }
}

export function registeredPanelRootId(source: RegisteredSource,
  { use, framePanelId }: Pick<ApplicationEntryResolution, "use" | "framePanelId">,
) {
  if (isNativeApplicationEntry(use)) return undefined;
  return source.kind === "frame" ? framePanelId : isApplicationPanelUse(use) ? use.panelId : undefined;
}

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

async function requireTarget(
  owner: ProductOwner, viewer: AssistantCredentials, target: Target, client?: QueryClient, batchCache?: PanelReadBatchCache,
  collectUse?: PanelUseCollector,
) {
  const row = await (batchCache
    ? batchCache.product(target, client)
    : findCurrentProduct(owner.domainId, target.kind, target.id, client));
  if (!row) {
    const kind = target.kind === "panel" ? "Panel" : "Projection";
    throw new HttpError(404, `${kind} '${target.id}' does not exist`, "PRODUCT_UNAVAILABLE");
  }
  if (!collectUse?.(target.kind, row))
    await (batchCache?.requireUse(target, row) ?? requireCurrentDefinitionUse(target.kind, row, owner.domainId, viewer));
  return row;
}

export async function requireRegisteredPanelRoot(
  owner: ProductOwner, viewer: AssistantCredentials, source: RegisteredSource,
  { client, expectedPanelId, batchCache, admitEntry, collectUse }: {
    client?: QueryClient; expectedPanelId?: string; batchCache?: PanelReadBatchCache; admitEntry?: boolean;
    collectUse?: PanelUseCollector;
  } = {},
) {
  const entry = await (admitEntry ? requirePanelEntry(viewer, source, owner).then(withPanelReadRegistration)
    : batchCache ? batchCache.entry(source) : readRegisteredPanelEntry(viewer, source, owner));
  const id = registeredPanelRootId(source, entry);
  if (id === undefined || (expectedPanelId !== undefined && expectedPanelId !== id))
    throw new HttpError(404, "This entry does not use the requested application frame", "PANEL_FRAME_UNAVAILABLE");

  const row = await requireTarget(owner, viewer, { kind: "panel", id }, client, batchCache, collectUse);
  return { panel: panelDefinition(row, false), entry: isApplicationPanelUse(entry.use) ? entry.use : undefined,
    framePanelId: entry.framePanelId, registration: entry.registration };
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

function pathKey(segment: Pick<PanelMemberPath[number], "member" | "itemKey">): PanelStatePathKey {
  if (segment.itemKey !== undefined) unavailable();
  return [segment.member];
}

/** Re-resolve the requested path from an authorized root. A denied member never supplies its definition. */
export function resolvePanelMemberPath<Root extends PanelPathRoot>(
  owner: ProductOwner, viewer: AssistantCredentials, root: Root, memberPath: readonly AnyPathSegment[],
  entry?: ApplicationPanelUse, client?: QueryClient, batchCache?: PanelReadBatchCache,
  candidateDefinition?: CandidateDefinition, collectUse?: PanelUseCollector,
) {
  return resolveMemberPath(owner, viewer, root, memberPath, entry, client, batchCache, candidateDefinition, collectUse);
}

async function resolveMemberPath<Root extends PanelPathRoot>(
  owner: ProductOwner, viewer: AssistantCredentials, root: Root, memberPath: readonly AnyPathSegment[],
  entry?: ApplicationPanelUse, client?: QueryClient, batchCache?: PanelReadBatchCache,
  candidateDefinition?: CandidateDefinition, collectUse?: PanelUseCollector,
) {
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
    const key = pathKey(segment);
    if (placement) keys.push([key[0], key[1], placement.id]);
    else keys.push(key);
    const target = await declaredTarget(owner, panel, member.target, placement ? undefined : segment.selection, entry, client);
    if (target.kind === "panel" && ancestors.has(target.id))
      throw new HttpError(409, `Panel member '${segment.member}' forms a cycle`, "PANEL_REFERENCE_CYCLE");
    const candidate = candidateDefinition?.(target);
    const row = candidate ? undefined : await requireTarget(owner, viewer, target, client, batchCache, collectUse);
    if (target.kind === "projection") {
      if (!isFinal) unavailable();
      const projection = parseStoredDefinition(productProjectionSchema, candidate ?? currentProductRecord(row!, false), "Projection");
      const component = isDomainComponentId(projection.componentId)
        ? await readProjectionComponent(projection.componentId, undefined, {
          domainId: projection.domainId, credentials: viewer, client,
          componentUsable: collectUse && (row => collectUse("component", row) ?? undefined),
        }) : undefined;
      if (isDomainComponentId(projection.componentId) && !component)
        throw new HttpError(404, "The registered component is unavailable", "COMPONENT_UNAVAILABLE");
      return { kind: "projection" as const, projection, panel, member, keys, trail, component };
    }
    if ("itemKey" in segment && segment.itemKey !== undefined) {
      throw new HttpError(422, "Row itemKey is only allowed on a projection member", "ROW_OPERATION_MEMBER_INVALID");
    }
    ancestors.add(target.id);
    const childPanel = candidate
      ? parseStoredDefinition(productPanelSchema, candidate, "Panel")
      : panelDefinition(row!, false);
    trail.push({ parentPanel: panel, childPanel, member, selection: placement ? undefined : segment.selection });
    panel = childPanel;
    controlled = Object.keys("fromPlatform" in member.target ? entry?.inputs ?? {} : member.inputs ?? {});
  }
  return { kind: "panel" as const, panel, keys, controlled, ancestors, trail };
}

export async function readNestedPanel(
  owner: ProductOwner, credentials: AssistantCredentials, { source, memberPath }: ProductPanelNestedReadRequest,
  bundleForRender = false,
): Promise<ProductPanelNestedReadResponse> {
  let entryInputs: ApplicationPanelUse["inputs"];
  const placement = await (async () => {
    if (source.kind === "candidate") {
      const { loadWorkspacePanel } = await import("../workspaces/panel-candidate");
      const { panel } = await loadWorkspacePanel(owner, credentials, source.workspace);
      return resolveMemberPath(owner, credentials, panel, memberPath);
    }
    if (source.kind === "app-candidate") {
      const { resolveApplicationPreviewPath } = await import("../app-builder/preview-service");
      return resolveApplicationPreviewPath(owner, credentials, source.app.id, source.app, memberPath);
    }
    const { panel, entry } = await requireRegisteredPanelRoot(owner, credentials, source);
    entryInputs = entry?.inputs;
    return resolveMemberPath(owner, credentials, panel, memberPath, entry);
  })();
  if (placement.kind !== "panel" || !("revision" in placement.panel))
    throw new HttpError(404, "The member path does not select a panel", "PANEL_MEMBER_UNAVAILABLE");
  const { id, revision, content, manifest, theme, domainId } = placement.panel;
  const member = placement.trail.at(-1)!.member;
  const projectionsForRender = bundleForRender && (source.kind === "registered" || source.kind === "frame");
  const [domainComponents, projections] = await Promise.all([
    readPanelDomainComponents({ domainId, credentials }, manifest.components),
    projectionsForRender ? readBundledPanelProjections(owner, credentials, bundledPanelProjectionIds(
      placement.panel, "fromPlatform" in member.target ? entryInputs : member.inputs,
    )) : undefined,
  ]);
  return {
    panel: { id, revision, content, manifest, ...(theme !== undefined && { theme }) },
    ...(projections && { projections }),
    ...(domainComponents && { domainComponents }),
  };
}
