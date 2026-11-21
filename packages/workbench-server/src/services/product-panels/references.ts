import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import {
  matchesDirectPanelValue, matchesObjectType, panelPlacementSchema, panelPortAccepts, type PanelManifest,
  type PanelPlacement,
} from "@ontomato/contracts/panel-manifest";
import {
  authoredReadParameterSource, directReadDeclaration, missingRequiredReadParameters, panelReadInputMatches, panelReadParameterId,
} from "@ontomato/contracts/panel-projection";
import {
  productPanelInputSchema, productProjectionInputSchema, type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assertAppBuilderAccess } from "../app-builder/access";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { listObjectDetailPanelMappings } from "./object-detail";
import { panelStateDomainPrefix, panelStateKeyNamespace } from "./personal-state-key";
import type { panelOperationTargetCheck } from "./type-table";

type QueryClient = Pick<PoolClient, "query">;
type Target = { kind: CurrentProductKind; id: string };
type Wiring = Pick<PanelPlacement, "inputs" | "outputs">;
type SavedPlacement = { field: string; placement: PanelPlacement };
type Reference = {
  key: string;
  target: Target;
  wiring: Wiring;
  fromObjectDetail?: true;
};

function fixedTarget(target: PanelPlacement["target"]): Target {
  return "panelId" in target ? { kind: "panel", id: target.panelId } : { kind: "projection", id: target.projectionId };
}

function collectReferences(
  panel: ProductPanelInput, details: ReadonlyMap<string, string>, saved: readonly SavedPlacement[] = [],
): Reference[] {
  const { state, members } = panel.manifest;
  const references: Reference[] = [];
  for (const [key, wiring] of Object.entries(members)) {
    const { target } = wiring;
    const add = (target: Target, fromObjectDetail?: true) =>
      references.push({ key, target, wiring, fromObjectDetail });
    if ("panelId" in target || "projectionId" in target) {
      add(fixedTarget(target));
    } else if ("fromState" in target) {
      const candidates = target.candidates;
      if ("panelIds" in candidates) {
        for (const id of candidates.panelIds) add({ kind: "panel", id });
      } else if ("projectionIds" in candidates) {
        for (const id of candidates.projectionIds) add({ kind: "projection", id });
      } else if (candidates.rule === "objectDetail") {
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
    } else if ("projectionIds" in type.candidates) {
      for (const id of type.candidates.projectionIds)
        references.push({ key: `$state.${name}`, target: { kind: "projection", id }, wiring: {} });
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

async function incompatiblePort(
  source: PanelManifest, { key, wiring }: Reference, definition: ProductPanelInput | ProductProjectionInput,
  readCatalogue = readPanelComponentCatalogue,
) {
  const target = ports(definition);
  const implicit = new Set<string>();
  const reads = "data" in definition ? Object.entries(definition.data).map(([name, datum]) => ({
    name, datum, declaration: directReadDeclaration(definition, datum)!,
  })) : [];
  for (const name of new Set([...Object.keys(wiring.inputs ?? {}), ...Object.keys(wiring.outputs ?? {})])) {
    for (const { datum, declaration } of reads) {
      const binding = authoredReadParameterSource(datum.params, name, wiring);
      const parameter = panelReadParameterId(declaration, name);
      if (!binding || !("state" in binding) || !parameter) continue;
      if (!panelReadInputMatches(parameter, source.state[binding.state]?.type))
        return `read parameter '${name}' does not accept its connected state field`;
      implicit.add(name);
    }
  }
  for (const [name, value] of Object.entries(wiring.inputs ?? {})) {
    const type = target.inputs[name];
    if (!type && "state" in value && implicit.has(name)) continue;
    if (!type) return `input '${name}' was removed or is not exposed`;
    // The view supplies a repeated row as an input; the read boundary checks its value against this port.
    if ("item" in value) continue;
    const offered = "state" in value ? source.state[value.state]?.type : undefined;
    if (!("literal" in value) && offered === undefined) return `input '${name}' has no declared value source`;
    if (type.kind === "json") continue;
    const accepts = "literal" in value ? matchesDirectPanelValue(type, value.literal)
      : offered !== undefined && panelPortAccepts(type, offered);
    if (!accepts) return `input '${name}' does not accept its connected value`;
  }
  for (const [name, value] of Object.entries(wiring.outputs ?? {})) {
    const type = target.outputs[name];
    const field = source.state[value.state];
    if (!type && implicit.has(name)) continue;
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
  if ("data" in definition) {
    for (const { name, datum, declaration } of reads) {
      if (!missingRequiredReadParameters(declaration, datum.params, undefined, wiring).length) continue;
      const { components } = await readCatalogue();
      const runtimeParams = appsSdkComponentDatum(components.get(definition.componentId)?.data, name)?.runtimeParams;
      const [missing] = missingRequiredReadParameters(declaration, datum.params, runtimeParams, wiring);
      if (missing !== undefined) return `data '${name}' requires parameter '${missing}'`;
    }
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
  let catalogue: ReturnType<typeof readPanelComponentCatalogue> | undefined;
  const readCatalogue = () => catalogue ??= readPanelComponentCatalogue();
  let checkOperationTarget: ReturnType<typeof panelOperationTargetCheck> | undefined;
  if ("componentId" in input && input.operations) {
    checkOperationTarget = (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
    const issue = await checkOperationTarget(input);
    if (issue) throw new HttpError(400, `Projection '${id}': ${issue}`, "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const checkMember = async (manifest: PanelManifest, reference: Reference, definition: ProductPanelInput | ProductProjectionInput) => {
    if ("componentId" in definition && definition.operations) {
      checkOperationTarget ??= (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
      const issue = await checkOperationTarget(definition, reference.wiring);
      if (issue) return issue;
    }
    return incompatiblePort(manifest, reference, definition, readCatalogue);
  };
  if ("manifest" in input) panels.set(id, input);
  const saved = await loadSavedPlacements(owner.domainId, panels, client);
  if ("manifest" in input) {
    rejectCycles(panels, details, [id]);

    const inspected = new Map<string, ProductPanelInput | ProductProjectionInput>();
    const authorized = new Set<string>();
    for (const reference of collectReferences(input, details)) {
      const { target, key } = reference;
      const known = inspected.get(target.id);
      const stored = known ?? (target.kind === "panel" ? panels.get(target.id)
        : (await findCurrentProduct(owner.domainId, "projection", target.id, client))?.definition);
      if (!stored) {
        await assertAppBuilderAccess(credentials);
        const kind = target.kind === "panel" ? "Panel" : "Projection";
        throw new HttpError(404, `Panel '${id}', member '${key}' – ${kind} '${target.id}' does not exist`, "PRODUCT_UNAVAILABLE");
      }
      if (!reference.fromObjectDetail && !authorized.has(target.id)) {
        await requireProductGrant(target.id, "use", credentials);
        authorized.add(target.id);
      }
      const definition = known ?? (target.kind === "panel" ? panels.get(target.id)! : productProjectionInputSchema.parse(stored));
      inspected.set(target.id, definition);
      const issue = await checkMember(input.manifest, reference, definition);
      if (issue) throw new HttpError(400, `Panel '${id}', member '${key}' – ${issue}`, "PANEL_PORT_MISMATCH");
    }
  }

  for (const [parentId, panel] of panels) {
    for (const reference of collectReferences(panel, details, saved.get(parentId))) {
      if (reference.target.kind !== kind || reference.target.id !== id) continue;
      const issue = await checkMember(panel.manifest, reference, input);
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
      const issue = await incompatiblePort(panel.manifest, reference, target);
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

  const issue = await incompatiblePort(panel.manifest, { key: field, target, wiring: placement }, definition);
  if (issue) throw new HttpError(400, `Personal placement '${field}': ${issue}`, "PANEL_PORT_MISMATCH");

  if (target.kind === "panel") rejectCycles(panels, details, [target.id], ancestors);
}
