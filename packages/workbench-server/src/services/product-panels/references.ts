import { z } from "zod";
import { missingEntryMessageKeys } from "@ontomato/contracts/panel-conversation-entry";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import {
  matchesDirectPanelValue, matchesObjectType, objectUnionTypes, panelManifestSchema, panelPlacementSchema, panelPortAccepts, panelStateInputType,
  type PanelMember, type PanelPlacement, type DirectPanelPortType,
} from "@ontomato/contracts/panel-manifest";
import {
  authoredReadParameterSource, directProjectionInputAccepts, directReadDeclaration, missingRequiredReadParameters, panelReadInputMatches, panelReadParameterId,
} from "@ontomato/contracts/panel-projection";
import {
  builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput, type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { currentProductRows, findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { isBuiltinProductId, isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { requireCurrentDefinitionUse } from "./access";
import { readPanelComponentCatalogue, readPanelDomainComponents, readProjectionComponent, type ComponentScope } from "./component-catalogue";
import { listObjectDetailPanelMappings } from "./object-detail";
import { panelStateDomainPrefix, panelStateKeyNamespace } from "./personal-state-key";
import type { panelOperationTargetCheck } from "./type-table";

type QueryClient = Pick<PoolClient, "query">;
/** Reference checks need the stored bindings, even when a panel cannot be opened. */
export const panelReferenceDefinitionSchema = productPanelInputSchema.pick({ name: true }).extend({
  manifest: panelManifestSchema.innerType().pick({ state: true, members: true }).strip(),
}).strip();
type PanelDefinition = z.infer<typeof panelReferenceDefinitionSchema>;
type ReferenceManifest = PanelDefinition["manifest"];
const storedPanelFactsSchema = z.object({
  name: z.string().trim().min(1).catch(""),
  manifest: z.object({ members: z.record(z.unknown()).catch({}), state: z.record(z.unknown()).catch({}) }),
});
const referenceManifestShape = panelReferenceDefinitionSchema.shape.manifest.shape;
type ProjectionDefinition = ProductProjectionInput | BuiltinProductProjectionInput;
type Target = { kind: CurrentProductKind; id: string };
type Wiring = {
  inputs?: PanelMember["inputs"] | PanelPlacement["inputs"];
  outputs?: PanelMember["outputs"];
  readOperationInputs?: PanelMember["readOperationInputs"];
  operationDrafts?: PanelMember["operationDrafts"];
};
type MemberWiring = Pick<PanelMember, "inputs" | "outputs" | "readOperationInputs" | "operationDrafts">;

function toMemberWiring(wiring: Wiring): MemberWiring {
  if (!wiring.inputs) {
    return {
      outputs: wiring.outputs,
      readOperationInputs: wiring.readOperationInputs,
      operationDrafts: wiring.operationDrafts,
    };
  }
  const inputs: NonNullable<PanelMember["inputs"]> = {};
  for (const [k, v] of Object.entries(wiring.inputs)) {
    if (!("item" in v)) inputs[k] = v;
  }
  return {
    inputs,
    outputs: wiring.outputs,
    readOperationInputs: wiring.readOperationInputs,
    operationDrafts: wiring.operationDrafts,
  };
}
type SavedPlacement = { field: string; placement: PanelPlacement };
type Reference = {
  key: string;
  target: Target;
  wiring: Wiring;
  fromObjectDetail?: { fromState: string; className: string };
  projectionCandidates?: true;
};

function fixedTarget(target: PanelPlacement["target"]): Target {
  return "panelId" in target ? { kind: "panel", id: target.panelId } : { kind: "projection", id: target.projectionId };
}

export function collectReferences(
  panel: Pick<PanelDefinition, "manifest">, details: ReadonlyMap<string, string>, saved: readonly SavedPlacement[] = [],
): Reference[] {
  const { state, members } = panel.manifest;
  const references: Reference[] = [];
  for (const [key, wiring] of Object.entries(members)) {
    const { target } = wiring;
    const add = (target: Target, fromObjectDetail?: Reference["fromObjectDetail"]) =>
      references.push({ key, target, wiring, fromObjectDetail });
    if ("panelId" in target || "projectionId" in target) {
      add(fixedTarget(target));
    } else if ("fromState" in target) {
      const candidates = target.candidates;
      if ("panelIds" in candidates) {
        for (const id of candidates.panelIds) add({ kind: "panel", id });
      } else if ("projectionIds" in candidates) {
        for (const id of candidates.projectionIds)
          references.push({ key, target: { kind: "projection", id }, wiring, projectionCandidates: true });
      } else if (candidates.rule === "objectDetail") {
        const type = state[target.fromState]?.type;
        if (type?.kind === "object" || type?.kind === "object-union") {
          for (const [className, id] of details) {
            if (matchesObjectType(type, className)) add({ kind: "panel", id }, { fromState: target.fromState, className });
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

function parseStoredPanelReferenceDefinition(id: string, definition: unknown) {
  const parsed = panelReferenceDefinitionSchema.safeParse(definition);
  if (parsed.success) return { panel: parsed.data, valid: true };

  const facts = storedPanelFactsSchema.safeParse(definition);
  if (!facts.success) return null;
  const members: ReferenceManifest["members"] = {};
  for (const [name, value] of Object.entries(facts.data.manifest.members)) {
    const member = referenceManifestShape.members.valueSchema.safeParse(value);
    if (member.success) members[name] = member.data;
  }
  const state: ReferenceManifest["state"] = {};
  for (const [name, value] of Object.entries(facts.data.manifest.state)) {
    const schema = referenceManifestShape.state.valueSchema;
    const field = schema.safeParse(value);
    if (field.success) {
      state[name] = field.data;
    } else if (typeof value === "object" && value !== null && "default" in value) {
      const { default: _invalidDefault, ...withoutDefault } = value;
      const recovered = schema.safeParse(withoutDefault);
      if (recovered.success && recovered.data.type.kind === "placement") state[name] = recovered.data;
    }
  }
  return { panel: { name: facts.data.name || id, manifest: { members, state } }, valid: false };
}

async function loadPanels(domainId: string, client: QueryClient, excluding?: string) {
  const { rows } = await client.query<{ id: string; definition: unknown }>(
    `SELECT id,definition FROM ${currentProductRows("panel")} AS definitions
     WHERE domain_id=$1 OR domain_id IS NULL ORDER BY id`, [domainId],
  );
  const panels = new Map<string, PanelDefinition>();
  const invalidIds = new Set<string>();
  for (const { id, definition } of rows) {
    if (id === excluding) continue;
    const parsed = parseStoredPanelReferenceDefinition(id, definition);
    if (parsed) panels.set(id, parsed.panel);
    if (!parsed?.valid) invalidIds.add(id);
  }
  return { panels, invalidIds };
}

async function loadDetails(domainId: string, client: QueryClient) {
  const mappings = await listObjectDetailPanelMappings(domainId, client);
  return new Map(mappings.map(({ className, panelId }) => [className, panelId]));
}

async function loadSavedPlacements(domainId: string, panels: ReadonlyMap<string, PanelDefinition>, client: QueryClient, tolerateInvalid = false) {
  const placements = new Map<string, SavedPlacement[]>();
  const hasPersonalPlacements = Array.from(panels.values()).some(({ manifest }) =>
    Object.values(manifest.state).some(field => field.personal && field.type.kind === "placement"));
  if (!hasPersonalPlacements) return placements;
  const scope = "substring(key FROM char_length($2::text)+1)";
  const parsedScope = tolerateInvalid ? `CASE WHEN ${scope} IS JSON ARRAY THEN ${scope}::jsonb END` : `${scope}::jsonb`;
  const { rows } = await client.query<{ scope: [string, string, unknown, string, string] | null; value: unknown }>(
    `SELECT ${parsedScope} AS scope,value
     FROM ${table("user_preferences")} WHERE starts_with(key,$1) AND jsonb_typeof(value)='object' AND value ? 'target'`,
    [panelStateDomainPrefix(domainId), panelStateKeyNamespace],
  );
  for (const { scope, value } of rows) {
    if (scope === null) continue;
    const [, , , panelId, field] = scope;
    const parsed = panelPlacementSchema.safeParse(value);
    if (!parsed.success) {
      if (tolerateInvalid) continue;
      throw parsed.error;
    }
    const placement = parsed.data;
    const existing = placements.get(panelId) ?? [];
    existing.push({ field, placement });
    placements.set(panelId, existing);
  }
  return placements;
}

export async function findPanelUsers(domainId: string, kind: CurrentProductKind, id: string, client: QueryClient = getPostgresPool(), excluding?: string) {
  const [{ panels }, details] = await Promise.all([loadPanels(domainId, client, excluding), loadDetails(domainId, client)]);
  const saved = await loadSavedPlacements(domainId, panels, client, true);
  return Array.from(panels, ([parentId, panel]) => ({ id: parentId, panel }))
    .filter(parent => collectReferences(parent.panel, details, saved.get(parent.id)).some(({ target }) => target.kind === kind && target.id === id))
    .map(({ id, panel }) => ({ id, name: panel.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

type ScopedProductId = { domainId: string | null; id: string };
type ProjectionPanelUse = ScopedProductId & { inputs: Set<string>; outputs: Set<string> };
export function productReferenceKey({ domainId, id }: ScopedProductId) {
  return JSON.stringify([domainId, id]);
}

/** Scan stored bindings in the domains of affected projections, including personal placements on built-in panels. */
export async function findProjectionPanelUsers(projections: readonly ScopedProductId[], client: QueryClient) {
  const ids = new Set(projections.map(productReferenceKey));
  const domains = new Set(projections.flatMap(({ domainId }) => domainId === null ? [] : [domainId]));
  const builtins = projections.some(({ domainId }) => domainId === null);
  const { rows } = await client.query<ScopedProductId & { definition: unknown }>(
    `SELECT domain_id AS "domainId",id,definition FROM ${currentProductRows("panel")} AS definitions
     WHERE domain_id IS NULL OR domain_id=ANY($1::text[]) OR $2::boolean`, [[...domains], builtins],
  );
  if (builtins) {
    const { rows: preferences } = await client.query<{ domainId: string }>(
      `SELECT DISTINCT CASE WHEN substring(key FROM char_length($1::text)+1) IS JSON ARRAY
        THEN substring(key FROM char_length($1::text)+1)::jsonb->>0 END AS "domainId"
       FROM ${table("user_preferences")} WHERE starts_with(key,$1)`, [panelStateKeyNamespace],
    );
    for (const { domainId } of preferences) if (domainId) domains.add(domainId);
  }

  const panels = new Map<string | null, Map<string, PanelDefinition>>();
  for (const { domainId, id, definition } of rows) {
    const parsed = parseStoredPanelReferenceDefinition(id, definition);
    if (!parsed) continue;
    const inDomain = panels.get(domainId) ?? new Map<string, PanelDefinition>();
    inDomain.set(id, parsed.panel);
    panels.set(domainId, inDomain);
    if (domainId !== null) domains.add(domainId);
  }
  const users = new Map<string, Map<string, ProjectionPanelUse>>();
  const platformPanels = panels.get(null);
  const record = (domainId: string | null, panel: ScopedProductId, references: readonly Reference[]) => {
    for (const { target, wiring } of references) {
      if (target.kind !== "projection") continue;
      const key = productReferenceKey({ id: target.id, domainId: isBuiltinProductId(target.id) ? null : domainId });
      if (!ids.has(key)) continue;
      const found = users.get(key) ?? new Map<string, ProjectionPanelUse>();
      const panelKey = productReferenceKey(panel);
      const use = found.get(panelKey) ?? { ...panel, inputs: new Set<string>(), outputs: new Set<string>() };
      for (const name of Object.keys(wiring.inputs ?? {})) use.inputs.add(name);
      for (const name of Object.keys(wiring.outputs ?? {})) use.outputs.add(name);
      found.set(panelKey, use);
      users.set(key, found);
    }
  };
  for (const [id, panel] of platformPanels ?? []) record(null, { domainId: null, id }, collectReferences(panel, new Map()));
  for (const domainId of domains) {
    const domainPanels = panels.get(domainId);
    const scoped = new Map([...platformPanels ?? [], ...domainPanels ?? []]);
    const saved = await loadSavedPlacements(domainId, scoped, client, true);
    for (const [id, panel] of scoped) {
      record(domainId, { domainId: domainPanels?.has(id) ? domainId : null, id },
        collectReferences(panel, new Map(), saved.get(id)));
    }
  }
  return users;
}

function rejectCycles(
  panels: ReadonlyMap<string, PanelDefinition>, details: ReadonlyMap<string, string>,
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

function ports(definition: PanelDefinition | ProjectionDefinition) {
  if (!("manifest" in definition)) return definition;
  const external = Object.fromEntries(Object.entries(definition.manifest.state)
    .filter(([, field]) => field.external)
    .map(([name, field]) => [name, field.type]));
  return { inputs: external, outputs: external };
}

// An absent entry is covered. A null entry has not been declared by any candidate yet.
type CandidateInputs = Map<string, Set<string> | null>;

function narrowCandidateInput(
  target: DirectPanelPortType, source: DirectPanelPortType | undefined, name: string, uncovered: CandidateInputs,
) {
  const wanted = target.kind === "list" && source?.kind === "list" ? target.items : target;
  const offered = target.kind === "list" && source?.kind === "list" ? source.items : source;
  if (wanted.kind !== "object" || offered?.kind !== "object-union" || !matchesObjectType(offered, wanted.objectType)) return false;
  if (uncovered.has(name)) {
    const remaining = uncovered.get(name) ?? new Set(objectUnionTypes(offered));
    remaining.delete(wanted.objectType);
    if (remaining.size) uncovered.set(name, remaining);
    else uncovered.delete(name);
  }
  return true;
}

async function checkReferences(
  references: readonly Reference[],
  check: (reference: Reference, uncovered?: CandidateInputs) => Promise<string | undefined>,
) {
  const candidates = new Map<Wiring, { key: string; uncovered: CandidateInputs }>();
  for (const reference of references) {
    let group = candidates.get(reference.wiring);
    if (reference.projectionCandidates && !group) {
      group = { key: reference.key, uncovered: new Map(Object.keys(reference.wiring.inputs ?? {}).map(name => [name, null])) };
      candidates.set(reference.wiring, group);
    }
    const issue = await check(reference, group?.uncovered);
    if (issue) return { key: reference.key, issue };
  }
  for (const { key, uncovered } of candidates.values()) {
    for (const [name, remaining] of uncovered) {
      const issue = remaining === null ? `input '${name}' was removed or is not exposed by any candidate`
        : `input '${name}' has no candidate for object types ${[...remaining].join(", ")}`;
      return { key, issue };
    }
  }
}

async function incompatiblePort(
  source: ReferenceManifest, { wiring, fromObjectDetail }: Reference, definition: PanelDefinition | ProjectionDefinition,
  readCatalogue = readPanelComponentCatalogue, scope?: ComponentScope, uncovered?: CandidateInputs,
) {
  const target = ports(definition);
  let component;
  if ("data" in definition && isDomainComponentId(definition.componentId)) {
    component = await readProjectionComponent(definition.componentId, readCatalogue, scope);
    if (!component) return `component '${definition.componentId}' is unavailable`;
  }
  const implicit = new Set<string>();
  const reads = "data" in definition ? Object.entries(definition.data).map(([name, datum]) => ({
    name, datum, declaration: directReadDeclaration(definition, datum)!,
  })) : [];
  const normalizedWiring = toMemberWiring(wiring);
  for (const name of new Set([...Object.keys(wiring.inputs ?? {}), ...Object.keys(wiring.outputs ?? {})])) {
    for (const { datum, declaration } of reads) {
      const selectionInput = "object" in datum.source && "input" in datum.source.object ? datum.source.object.input : undefined;
      if (uncovered && declaration.parameterMode === "owner" && !Object.hasOwn(wiring.outputs ?? {}, name)) continue;
      if (
        !Object.hasOwn(datum.params, name)
        && (name === selectionInput
          || (declaration.parameterMode === "owner"
            && (Object.hasOwn(target.inputs, name) || Object.hasOwn(target.outputs, name))))
      ) {
        continue;
      }
      const binding = authoredReadParameterSource(datum.params, name, normalizedWiring);
      const parameter = panelReadParameterId(declaration, name);
      if (!binding || !parameter || (!("state" in binding) && !("output" in binding))) continue;
      if ("state" in binding && !panelReadInputMatches(parameter, panelStateInputType(binding, source.state[binding.state]?.type)))
        return `read parameter '${name}' does not accept its connected state field`;
      implicit.add(name);
      if (declaration.parameterMode === "fixed" && !Object.hasOwn(target.inputs, name)) uncovered?.delete(name);
    }
  }
  for (const [name, value] of Object.entries(wiring.inputs ?? {})) {
    const type = target.inputs[name];
    if (!type) {
      if (!uncovered && !(("state" in value || "output" in value) && implicit.has(name)))
        return `input '${name}' was removed or is not exposed`;
      continue;
    }
    if ("item" in value || "output" in value) {
      uncovered?.delete(name);
      continue;
    }
    const rawStateType = "state" in value
      ? (fromObjectDetail && value.state === fromObjectDetail.fromState
        ? { kind: "object" as const, objectType: fromObjectDetail.className }
        : source.state[value.state]?.type)
      : undefined;
    const offered = "state" in value ? panelStateInputType(value, rawStateType) : undefined;
    if (!("literal" in value) && offered === undefined) return `input '${name}' has no declared value source`;
    const accepts = "literal" in value ? type.kind === "json" || matchesDirectPanelValue(type, value.literal)
      : offered !== undefined && directProjectionInputAccepts(type, offered);
    if (accepts) uncovered?.delete(name);
    else if (!uncovered || !narrowCandidateInput(type, offered, name, uncovered))
      return `input '${name}' does not accept its connected value`;
  }
  for (const [name, value] of Object.entries(wiring.outputs ?? {})) {
    const type = target.outputs[name];
    const field = source.state[value.state];
    if (!type && implicit.has(name)) continue;
    if (!type || !field || !panelPortAccepts(field.type, type))
      return `output '${name}' does not match its connected field`;
  }
  if ("data" in definition) {
    for (const { name, datum, declaration } of reads) {
      if (!missingRequiredReadParameters(declaration, datum.params, undefined, normalizedWiring).length) continue;
      component ??= await readProjectionComponent(definition.componentId, readCatalogue, scope);
      const runtimeParams = appsSdkComponentDatum(component?.data, name)?.runtimeParams;
      const [missing] = missingRequiredReadParameters(declaration, datum.params, runtimeParams, normalizedWiring);
      if (missing !== undefined) return `data '${name}' requires parameter '${missing}'`;
    }
  }
}

async function requireProjection(domainId: string, id: string, client: QueryClient) {
  const row = await findCurrentProduct(domainId, "projection", id, client);
  if (!row) throw new HttpError(404, "Current projection definition not found", "PRODUCT_UNAVAILABLE");
  return projectionDefinition(id, row.definition);
}

function projectionDefinition(id: string, definition: unknown) {
  return (isBuiltinProductId(id) ? builtinProductProjectionInputSchema : productProjectionInputSchema).parse(definition);
}

export async function validateCurrentProductReferences(
  owner: ProductOwner, credentials: AssistantCredentials, kind: CurrentProductKind, id: string,
  input: ProductPanelInput | ProductProjectionInput, client: PoolClient,
) {
  const [{ panels, invalidIds }, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  let catalogue: ReturnType<typeof readPanelComponentCatalogue> | undefined;
  const readCatalogue = () => catalogue ??= readPanelComponentCatalogue();
  let checkOperationTarget: ReturnType<typeof panelOperationTargetCheck> | undefined;
  if ("componentId" in input && input.operations) {
    checkOperationTarget = (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
    const issue = await checkOperationTarget(input);
    if (issue) throw new HttpError(400, `Projection '${id}': ${issue}`, "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const checkMember = async (
    manifest: ReferenceManifest, reference: Reference, definition: PanelDefinition | ProjectionDefinition, uncovered?: CandidateInputs,
  ) => {
    if ("componentId" in definition && definition.operations) {
      checkOperationTarget ??= (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
      const issue = await checkOperationTarget(definition, toMemberWiring(reference.wiring));
      if (issue) return issue;
    }
    return incompatiblePort(manifest, reference, definition, readCatalogue, {
      domainId: isBuiltinProductId(reference.target.id) ? null : owner.domainId, credentials, client,
    }, uncovered);
  };
  if ("manifest" in input) {
    panels.set(id, input);
    invalidIds.delete(id);
  }
  const saved = await loadSavedPlacements(owner.domainId, panels, client);
  if ("manifest" in input) {
    const rejectUnavailable = ({ target, key }: Reference): never => {
      const kind = target.kind === "panel" ? "Panel" : "Projection";
      throw new HttpError(404, `Panel '${id}', member '${key}' – ${kind} '${target.id}' does not exist`, "PRODUCT_UNAVAILABLE");
    };
    const references = collectReferences(input, details);
    const invalidReference = references.find(({ target }) => target.kind === "panel" && invalidIds.has(target.id));
    if (invalidReference) rejectUnavailable(invalidReference);
    rejectCycles(panels, details, [id]);
    await readPanelDomainComponents({ domainId: owner.domainId, credentials, client }, input.manifest.components, { strict: true });

    const inspected = new Map<string, PanelDefinition | ProjectionDefinition>();
    const authorized = new Set<string>();
    const invalid = await checkReferences(references, async (reference, uncovered) => {
      const { target } = reference;
      const known = inspected.get(target.id);
      const stored = known ?? (target.kind === "panel" ? panels.get(target.id)
        : (await findCurrentProduct(owner.domainId, "projection", target.id, client))?.definition);
      if (!stored) rejectUnavailable(reference);
      if (!reference.fromObjectDetail && !authorized.has(target.id)) {
        const row = await findCurrentProduct(owner.domainId, target.kind, target.id, client);
        if (!row) return rejectUnavailable(reference);
        await requireCurrentDefinitionUse(target.kind, row, owner.domainId, credentials);
        authorized.add(target.id);
      }
      const definition = known ?? (target.kind === "panel" ? panels.get(target.id)! : projectionDefinition(target.id, stored));
      inspected.set(target.id, definition);
      return checkMember(input.manifest, reference, definition, uncovered);
    });
    if (invalid) throw new HttpError(400, `Panel '${id}', member '${invalid.key}' – ${invalid.issue}`, "PANEL_PORT_MISMATCH");
  }

  for (const [parentId, panel] of panels) {
    const references = collectReferences(panel, details, saved.get(parentId));
    const matches = ({ target }: Reference) => target.kind === kind && target.id === id;
    const groups = new Set(references.filter(reference => reference.projectionCandidates && matches(reference)).map(({ wiring }) => wiring));
    const connected = references.filter(reference => matches(reference) || groups.has(reference.wiring));
    const invalid = await checkReferences(connected, async (reference, uncovered) => {
      const definition = matches(reference) ? input : await requireProjection(owner.domainId, reference.target.id, client);
      return checkMember(panel.manifest, reference, definition, uncovered);
    });
    if (invalid) throw new HttpError(409, `Connected ${invalid.issue}`, "PRODUCT_PORT_IN_USE");
  }
}

export async function validateObjectDetailPanelMapping(domainId: string, className: string, panelId: string, client: PoolClient) {
  const [{ panels, invalidIds }, details] = await Promise.all([loadPanels(domainId, client), loadDetails(domainId, client)]);
  const target = panels.get(panelId);
  if (!target || invalidIds.has(panelId)) throw new HttpError(404, "Current detail panel definition not found", "PRODUCT_UNAVAILABLE");

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
  owner: ProductOwner, viewer: AssistantCredentials, panel: Pick<PanelDefinition, "manifest">, ancestors: ReadonlySet<string>,
  field: string, placement: PanelPlacement, client: PoolClient,
) {
  const target = fixedTarget(placement.target);
  const [{ panels, invalidIds }, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  const unavailable = () => new HttpError(404, "Selected member does not exist", "PRODUCT_UNAVAILABLE");
  if (target.kind === "panel" && invalidIds.has(target.id)) throw unavailable();
  const row = await findCurrentProduct(owner.domainId, target.kind, target.id, client);
  if (!row) throw unavailable();
  await requireCurrentDefinitionUse(target.kind, row, owner.domainId, viewer);
  const definition = target.kind === "panel" ? panels.get(target.id) : await requireProjection(owner.domainId, target.id, client);
  if (!definition) throw unavailable();

  const issue = await incompatiblePort(panel.manifest, { key: field, target, wiring: placement }, definition, undefined,
    { domainId: isBuiltinProductId(target.id) ? null : owner.domainId, credentials: viewer, client });
  if (issue) throw new HttpError(400, `Personal placement '${field}': ${issue}`, "PANEL_PORT_MISMATCH");

  if (target.kind === "panel") rejectCycles(panels, details, [target.id], ancestors);
}

export async function validateBuiltinProductReferences(
  panels: ReadonlyMap<string, BuiltinProductPanelInput>, projections: ReadonlyMap<string, BuiltinProductProjectionInput>,
  readCatalogue: typeof readPanelComponentCatalogue,
) {
  const details = new Map<string, string>();
  rejectCycles(panels, details, panels.keys());
  const checkOperationTarget = (await import("./type-table")).builtinPanelOperationTargetCheck();
  for (const [id, projection] of projections) {
    const issue = await checkOperationTarget(projection);
    if (issue) throw new Error(`Platform projection '${id}': ${issue}`);
  }
  for (const [id, panel] of panels) {
    const invalid = await checkReferences(collectReferences(panel, details), async (reference, uncovered) => {
      const { target, key } = reference;
      const definition = target.kind === "panel" ? panels.get(target.id) : projections.get(target.id);
      if (!definition) throw new Error(`Platform panel '${id}', member '${key}' refers to missing ${target.kind} '${target.id}'`);
      const issue = "componentId" in definition ? await checkOperationTarget(definition, toMemberWiring(reference.wiring)) : undefined;
      const incompatible = issue ?? await incompatiblePort(panel.manifest, reference, definition, readCatalogue, undefined, uncovered);
      if (incompatible) return incompatible;
      // A platform panel ships to every language: the opening sentence its entry names by key is in each one it declares.
      if ("componentId" in definition) {
        const [missing] = missingEntryMessageKeys([definition.conversationEntry], panel.content.messages);
        if (missing) throw new Error(`Platform panel '${id}', member '${key}': prefillKey '${missing.key}' is not in content.messages (${missing.locale ?? "any locale"})`);
      }
    });
    if (invalid) throw new Error(`Platform panel '${id}', member '${invalid.key}': ${invalid.issue}`);
  }
}
