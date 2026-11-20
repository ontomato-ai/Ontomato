import {
  matchesDirectPanelValue, matchesObjectType, panelPlacementSchema, panelPortAccepts, panelStateFieldSchema, panelStateRefSchema,
  type DirectPanelPortType, type PanelManifest,
  type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import { parsePanelLayout, type PanelLayoutNode } from "@ontomato/contracts/panel-layout";
import {
  panelNeedsFrame, productPanelInputSchema, productProjectionInputSchema, type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { listObjectDetailPanelMappings } from "./object-detail";
import { panelStateDomainPrefix, panelStateKeyNamespace } from "./personal-state-key";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type Wiring = Pick<PanelPlacement, "inputs" | "outputs">;
type SavedPlacement = { field: string; placement: PanelPlacement };
type Reference = {
  key: string;
  target: Target;
  wiring: Wiring;
  itemType?: DirectPanelPortType;
  fromObjectDetail?: true;
};

function fixedTarget(target: PanelPlacement["target"]): Target {
  return "panelId" in target ? { kind: "panel", id: target.panelId } : { kind: "projection", id: target.projectionId };
}

export function repeatItemTypes(panel: ProductPanelInput): Map<string, DirectPanelPortType> {
  const items = new Map<string, DirectPanelPortType>();
  if (panelNeedsFrame(panel.content)) return items;
  const { state } = panel.manifest;
  function collect(nodes: PanelLayoutNode[], item?: DirectPanelPortType) {
    for (const node of nodes) {
      if (node.kind === "member") {
        if (item) items.set(node.ref, item);
      } else {
        const source = node.each === undefined ? undefined : state[node.each].type;
        collect(node.children, source?.kind === "list" ? source.items : item);
      }
    }
  }
  collect(parsePanelLayout(panel.content.html, panel.manifest));
  return items;
}

function collectReferences(
  panel: ProductPanelInput, details: ReadonlyMap<string, string>, saved: readonly SavedPlacement[] = [],
): Reference[] {
  const { state, members } = panel.manifest;
  const usesItem = Object.values(members).some(member => Object.values(member.inputs ?? {}).some(input => "item" in input));
  const repeatTypes = usesItem ? repeatItemTypes(panel) : new Map<string, DirectPanelPortType>();
  const references: Reference[] = [];
  for (const [key, wiring] of Object.entries(members)) {
    const { target } = wiring;
    const add = (target: Target, fromObjectDetail?: true) =>
      references.push({ key, target, wiring, itemType: repeatTypes.get(key), fromObjectDetail });
    if ("panelId" in target || "projectionId" in target) {
      add(fixedTarget(target));
    } else if ("fromState" in target) {
      const candidates = target.candidates;
      if ("panelIds" in candidates) {
        for (const id of candidates.panelIds) add({ kind: "panel", id });
      } else {
        const { type } = state[target.fromState];
        if (type.kind === "object" || type.kind === "object-union") {
          for (const [className, id] of details) {
            if (matchesObjectType(type, className)) add({ kind: "panel", id }, true);
          }
        }
      }
    }
  }
  for (const [name, { type, default: value }] of Object.entries(state)) {
    if (type.kind !== "placement") continue;
    if ("panelIds" in type.candidates) {
      for (const id of type.candidates.panelIds)
        references.push({ key: `$state.${name}`, target: { kind: "panel", id }, wiring: {} });
    }
    if (value != null) {
      const placement = panelPlacementSchema.parse(value);
      references.push({ key: `$state.${name}`, target: fixedTarget(placement.target), wiring: placement });
    }
  }
  for (const { field, placement } of saved) {
    if (state[field]?.personal && state[field].type.kind === "placement") {
      references.push({ key: `$state.${field}`, target: fixedTarget(placement.target), wiring: placement });
    }
  }
  return references;
}

const storedSlotPanelSchema = productPanelInputSchema.innerType().extend({
  sdkVersion: z.string().min(1),
  manifest: z.object({
    state: z.record(z.object({ deepLink: z.boolean().default(false) }).passthrough()
      .transform(({ deepLink, ...type }) => ({
        deepLink,
        type: type.kind === "objects" ? { kind: "list", items: { kind: "object", objectType: type.objectType } } : type,
      })).pipe(panelStateFieldSchema)),
    slots: z.record(z.object({
      projectionId: z.string().min(1),
      inputs: z.record(panelStateRefSchema).default({}),
      outputs: z.record(panelStateRefSchema).optional(),
    })),
  }),
});

/** During re-registration, a stored SDK slot still owns its dependency until its replacement is saved. */
function storedPanelReferences(definition: Record<string, unknown>): ProductPanelInput {
  if (!Object.hasOwn(definition, "sdkVersion")) return productPanelInputSchema.parse(definition);
  const { sdkVersion: _version, manifest, ...panel } = storedSlotPanelSchema.parse(definition);
  return {
    ...panel,
    manifest: {
      state: manifest.state,
      members: Object.fromEntries(Object.entries(manifest.slots).map(([key, { projectionId, ...ports }]) =>
        [key, { target: { projectionId }, ...ports }])),
      events: {},
    },
  };
}

async function loadPanels(domainId: string, client: QueryClient, replacing?: string) {
  const { rows } = await client.query<{ id: string; definition: Record<string, unknown> }>(
    `SELECT id,definition FROM ${table("product_panels")} WHERE domain_id=$1 AND id IS DISTINCT FROM $2 ORDER BY id`,
    [domainId, replacing ?? null],
  );
  return new Map(rows.map(({ id, definition }) => [id, storedPanelReferences(definition)]));
}

async function loadDetails(domainId: string, client: QueryClient) {
  const mappings = await listObjectDetailPanelMappings(domainId, client);
  return new Map(mappings.map(({ className, panelId }) => [className, panelId]));
}

async function loadSavedPlacements(domainId: string, panels: ReadonlyMap<string, ProductPanelInput>, client: QueryClient) {
  const placements = new Map<string, SavedPlacement[]>();
  const hasPersonalPlacements = Array.from(panels.values()).some(({ manifest }) =>
    Object.values(manifest.state).some(field => field.personal && field.type.kind === "placement"));
  if (!hasPersonalPlacements) return placements;
  const { rows } = await client.query<{ scope: [string, string, unknown, string, string]; value: unknown }>(
    `SELECT substring(key FROM char_length($2::text)+1)::jsonb AS scope,value
     FROM ${table("user_preferences")} WHERE starts_with(key,$1) AND jsonb_typeof(value)='object' AND value ? 'target'`,
    [panelStateDomainPrefix(domainId), panelStateKeyNamespace],
  );
  for (const { scope: [, , , panelId, field], value } of rows) {
    const placement = panelPlacementSchema.parse(value);
    const existing = placements.get(panelId) ?? [];
    existing.push({ field, placement });
    placements.set(panelId, existing);
  }
  return placements;
}

export async function findPanelUsers(domainId: string, kind: CurrentProductKind, id: string, client: QueryClient = getPostgresPool()) {
  const [panels, details] = await Promise.all([loadPanels(domainId, client), loadDetails(domainId, client)]);
  const saved = await loadSavedPlacements(domainId, panels, client);
  return Array.from(panels, ([parentId, panel]) => ({ id: parentId, panel }))
    .filter(parent => collectReferences(parent.panel, details, saved.get(parent.id)).some(({ target }) => target.kind === kind && target.id === id))
    .map(({ id, panel }) => ({ id, name: panel.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function rejectCycles(
  panels: ReadonlyMap<string, ProductPanelInput>, details: ReadonlyMap<string, string>,
  roots: Iterable<string>, ancestors: Iterable<string> = [],
) {
  const checked = new Set<string>();
  const active = new Set(ancestors);
  const memberPath: string[] = [];
  function visit(id: string) {
    if (active.has(id)) {
      throw new HttpError(409, `Panel members form a cycle: ${memberPath.join(" → ")}`, "PANEL_REFERENCE_CYCLE");
    }
    if (checked.has(id)) return;
    const panel = panels.get(id);
    if (!panel) return;
    active.add(id);
    for (const { key, target } of collectReferences(panel, details)) {
      if (target.kind !== "panel") continue;
      memberPath.push(key);
      visit(target.id);
      memberPath.pop();
    }
    active.delete(id);
    checked.add(id);
  }
  for (const root of roots) visit(root);
}

function ports(definition: ProductPanelInput | ProductProjectionInput) {
  if (!("manifest" in definition)) return definition;
  const external = Object.fromEntries(Object.entries(definition.manifest.state)
    .filter(([, field]) => field.external)
    .map(([name, field]) => [name, field.type]));
  return { inputs: external, outputs: external };
}

function incompatiblePort(
  source: PanelManifest, { key, wiring, itemType }: Reference, definition: ProductPanelInput | ProductProjectionInput,
) {
  const target = ports(definition);
  for (const [name, value] of Object.entries(wiring.inputs ?? {})) {
    const type = target.inputs[name];
    if (!type) return `input '${name}' was removed or is not exposed`;
    const offered = "state" in value ? source.state[value.state]?.type : itemType;
    if (!("literal" in value) && offered === undefined) return `input '${name}' has no declared value source`;
    if (type.kind === "json") continue;
    const accepts = "literal" in value ? matchesDirectPanelValue(type, value.literal)
      : offered !== undefined && panelPortAccepts(type, offered);
    if (!accepts) return `input '${name}' does not accept its connected value`;
  }
  for (const [name, value] of Object.entries(wiring.outputs ?? {})) {
    const type = target.outputs[name];
    const field = source.state[value.state];
    if (!type || !field || !panelPortAccepts(field.type, type))
      return `output '${name}' does not match its connected field`;
  }
  for (const { on, do: action } of Object.values(source.events)) {
    if (on?.member !== key) continue;
    const type = target.outputs[on.output];
    if (!type) return `output '${on.output}' does not exist`;
    if ("set" in action && Object.entries(action.set.fields)
      .some(([field, value]) => "event" in value && !panelPortAccepts(source.state[field].type, type)))
      return `output '${on.output}' does not match its event's state fields`;
  }
}

async function requireProjection(domainId: string, id: string, client: QueryClient) {
  const row = await findCurrentProduct(domainId, "projection", id, client);
  if (!row) throw new HttpError(404, "Current projection definition not found", "PRODUCT_UNAVAILABLE");
  return productProjectionInputSchema.parse(row.definition);
}

export async function validateCurrentProductReferences(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  input: ProductPanelInput | ProductProjectionInput, client: PoolClient,
) {
  const [panels, details] = await Promise.all([
    loadPanels(owner.domainId, client, kind === "panel" ? id : undefined), loadDetails(owner.domainId, client),
  ]);
  if ("manifest" in input) panels.set(id, input);
  const saved = await loadSavedPlacements(owner.domainId, panels, client);
  if ("manifest" in input) {
    rejectCycles(panels, details, [id]);

    const inspected = new Map<string, ProductPanelInput | ProductProjectionInput>();
    const authorized = new Set<string>();
    for (const reference of collectReferences(input, details)) {
      const { target, key } = reference;
      if (!reference.fromObjectDetail && !authorized.has(target.id)) {
        await requireProductGrant(target.id, "use", credentials);
        authorized.add(target.id);
      }
      let definition = inspected.get(target.id);
      if (!definition) {
        definition = target.kind === "panel" ? panels.get(target.id) : await requireProjection(owner.domainId, target.id, client);
        if (!definition) throw new HttpError(404, "Current member definition not found", "PRODUCT_UNAVAILABLE");
        inspected.set(target.id, definition);
      }
      const issue = incompatiblePort(input.manifest, reference, definition);
      if (issue) throw new HttpError(400, `Member '${key}': ${issue}`, "PANEL_PORT_MISMATCH");
    }
  }

  for (const [parentId, panel] of panels) {
    for (const reference of collectReferences(panel, details, saved.get(parentId))) {
      if (reference.target.kind !== kind || reference.target.id !== id) continue;
      const issue = incompatiblePort(panel.manifest, reference, input);
      if (issue) throw new HttpError(409, `Connected ${issue}`, "PRODUCT_PORT_IN_USE");
    }
  }
}

export async function validateObjectDetailPanelMapping(domainId: string, className: string, panelId: string, client: PoolClient) {
  const [panels, details] = await Promise.all([loadPanels(domainId, client), loadDetails(domainId, client)]);
  const target = panels.get(panelId);
  if (!target) throw new HttpError(404, "Current detail panel definition not found", "PRODUCT_UNAVAILABLE");

  details.set(className, panelId);
  const saved = await loadSavedPlacements(domainId, panels, client);
  rejectCycles(panels, details, panels.keys());

  for (const [parentId, panel] of panels) {
    for (const reference of collectReferences(panel, details, saved.get(parentId))) {
      if (reference.target.kind !== "panel" || reference.target.id !== panelId) continue;
      const issue = incompatiblePort(panel.manifest, reference, target);
      if (issue) throw new HttpError(409, `Connected ${issue}`, "PRODUCT_PORT_IN_USE");
    }
  }
}

export async function validatePersonalPlacement(
  owner: ProductOwner, viewer: AssistantCredentials, panel: ProductPanelInput, ancestors: ReadonlySet<string>,
  field: string, placement: PanelPlacement, client: PoolClient,
) {
  const target = fixedTarget(placement.target);
  const [panels, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  await requireProductGrant(target.id, "use", viewer);
  const definition = target.kind === "panel" ? panels.get(target.id) : await requireProjection(owner.domainId, target.id, client);
  if (!definition) throw new HttpError(404, "Selected member does not exist", "PRODUCT_UNAVAILABLE");

  const issue = incompatiblePort(panel.manifest, { key: field, target, wiring: placement }, definition);
  if (issue) throw new HttpError(400, `Personal placement '${field}': ${issue}`, "PANEL_PORT_MISMATCH");

  if (target.kind === "panel") rejectCycles(panels, details, [target.id], ancestors);
}
