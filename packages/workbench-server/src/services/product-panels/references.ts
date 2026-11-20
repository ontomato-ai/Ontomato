import {
  matchesDirectPanelValue, matchesObjectType, panelPlacementSchema, panelPortAccepts, type DirectPanelPortType, type PanelManifest,
  type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import { parsePanelLayout, type PanelLayoutNode } from "@ontomato/contracts/panel-layout";
import {
  panelNeedsFrame, productPanelInputSchema, productProjectionInputSchema, type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { listObjectDetailPanelMappings } from "./object-detail";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type Wiring = Pick<PanelPlacement, "inputs" | "outputs">;
type Reference = {
  key: string;
  target: Target;
  wiring: Wiring;
  itemType?: DirectPanelPortType;
  triggerOutputs?: string[];
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

function collectReferences(panel: ProductPanelInput, details: ReadonlyMap<string, string>): Reference[] {
  const { state, members, events } = panel.manifest;
  const usesItem = Object.values(members).some(member => Object.values(member.inputs ?? {}).some(input => "item" in input));
  const repeatTypes = usesItem ? repeatItemTypes(panel) : new Map<string, DirectPanelPortType>();
  const references: Reference[] = [];
  for (const [key, wiring] of Object.entries(members)) {
    const { target } = wiring;
    const triggerOutputs = Object.values(events).flatMap(({ on }) => on?.member === key ? [on.output] : []);
    const add = (target: Target) => references.push({ key, target, wiring, itemType: repeatTypes.get(key), triggerOutputs });
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
            if (matchesObjectType(type, className)) add({ kind: "panel", id });
          }
        }
      }
    }
  }
  for (const [name, { type, default: value }] of Object.entries(state)) {
    if (type.kind === "placement" && value != null) {
      const placement = panelPlacementSchema.parse(value);
      references.push({ key: `$state.${name}`, target: fixedTarget(placement.target), wiring: placement });
    }
  }
  return references;
}

async function loadPanels(domainId: string, client: QueryClient) {
  const { rows } = await client.query<{ id: string; definition: unknown }>(
    `SELECT id,definition FROM ${table("product_panels")} WHERE domain_id=$1 ORDER BY id`, [domainId],
  );
  return new Map(rows.map(({ id, definition }) => [id, productPanelInputSchema.parse(definition)]));
}

async function loadDetails(domainId: string, client: QueryClient) {
  const mappings = await listObjectDetailPanelMappings(domainId, client);
  return new Map(mappings.map(({ className, panelId }) => [className, panelId]));
}

export async function findPanelUsers(domainId: string, kind: CurrentProductKind, id: string, client: QueryClient = getPostgresPool()) {
  const [panels, details] = await Promise.all([loadPanels(domainId, client), loadDetails(domainId, client)]);
  return Array.from(panels, ([parentId, panel]) => ({ id: parentId, panel }))
    .filter(({ panel }) => collectReferences(panel, details).some(({ target }) => target.kind === kind && target.id === id))
    .map(({ id, panel }) => ({ id, name: panel.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function rejectCycles(panels: ReadonlyMap<string, ProductPanelInput>, details: ReadonlyMap<string, string>, roots: Iterable<string>) {
  const checked = new Set<string>();
  const active = new Set<string>();
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
  source: PanelManifest, { wiring, itemType, triggerOutputs }: Reference, definition: ProductPanelInput | ProductProjectionInput,
) {
  const target = ports(definition);
  for (const [name, value] of Object.entries(wiring.inputs ?? {})) {
    const type = target.inputs[name];
    if (!type) return `input '${name}' was removed or is not exposed`;
    if (type.kind === "json") continue;
    const accepts = "literal" in value ? matchesDirectPanelValue(type, value.literal)
      : "state" in value ? panelPortAccepts(type, source.state[value.state].type)
      : itemType !== undefined && panelPortAccepts(type, itemType);
    if (!accepts) return `input '${name}' does not accept its connected value`;
  }
  for (const [name, value] of Object.entries(wiring.outputs ?? {})) {
    const type = target.outputs[name];
    if (!type || !panelPortAccepts(source.state[value.state].type, type))
      return `output '${name}' does not match its connected field`;
  }
  for (const name of triggerOutputs ?? []) {
    if (!Object.hasOwn(target.outputs, name)) return `output '${name}' does not exist`;
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
  const [panels, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  if ("manifest" in input) {
    panels.set(id, input);
    rejectCycles(panels, details, [id]);

    const approved = new Map<string, ProductPanelInput | ProductProjectionInput>();
    for (const reference of collectReferences(input, details)) {
      const { target, key } = reference;
      let definition = approved.get(target.id);
      if (!definition) {
        await requireProductGrant(target.id, "use", credentials);
        definition = target.kind === "panel" ? panels.get(target.id) : await requireProjection(owner.domainId, target.id, client);
        if (!definition) throw new HttpError(404, "Current member definition not found", "PRODUCT_UNAVAILABLE");
        approved.set(target.id, definition);
      }
      const issue = incompatiblePort(input.manifest, reference, definition);
      if (issue) throw new HttpError(400, `Member '${key}': ${issue}`, "PANEL_PORT_MISMATCH");
    }
  }

  for (const panel of panels.values()) {
    for (const reference of collectReferences(panel, details)) {
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
  rejectCycles(panels, details, panels.keys());

  for (const panel of panels.values()) {
    for (const reference of collectReferences(panel, details)) {
      if (reference.target.kind !== "panel" || reference.target.id !== panelId) continue;
      const issue = incompatiblePort(panel.manifest, reference, target);
      if (issue) throw new HttpError(409, `Connected ${issue}`, "PRODUCT_PORT_IN_USE");
    }
  }
}
