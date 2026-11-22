import { z } from "zod";
import { missingEntryMessageKeys } from "@ontomato/contracts/panel-conversation-entry";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import {
  matchesDirectPanelValue, matchesObjectType, panelManifestSchema, panelPlacementSchema, panelPortAccepts, type PanelMember,
  type PanelPlacement,
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
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assertAppBuilderAccess } from "../app-builder/access";
import { requireProductGrant, type ProductOwner } from "../product-governance/grants";
import { readPanelComponentCatalogue, readProjectionComponent } from "./component-catalogue";
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
type ProjectionDefinition = ProductProjectionInput | BuiltinProductProjectionInput;
type Target = { kind: CurrentProductKind; id: string };
type Wiring = Pick<PanelMember, "inputs" | "outputs" | "readOperationInputs" | "listColumn">;
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
  panel: Pick<PanelDefinition, "manifest">, details: ReadonlyMap<string, string>, saved: readonly SavedPlacement[] = [],
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
        const type = state[target.fromState]?.type;
        if (type?.kind === "object" || type?.kind === "object-union") {
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

async function loadPanels(domainId: string, client: QueryClient, excluding?: string) {
  const { rows } = await client.query<{ id: string; definition: unknown }>(
    `SELECT id,definition FROM ${currentProductRows("panel")} AS definitions
     WHERE domain_id=$1 OR domain_id IS NULL ORDER BY id`, [domainId],
  );
  return new Map(rows.filter(row => row.id !== excluding).map(({ id, definition }) => [id, panelReferenceDefinitionSchema.parse(definition)]));
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
  const [panels, details] = await Promise.all([loadPanels(domainId, client, excluding), loadDetails(domainId, client)]);
  const saved = await loadSavedPlacements(domainId, panels, client);
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
  const facts = z.object({ manifest: z.object({ members: z.record(z.unknown()).catch({}), state: z.record(z.unknown()).catch({}) }) });
  const manifest = panelManifestSchema.innerType().shape;

  const retained = <T>(values: Record<string, unknown>, schema: z.ZodType<T, z.ZodTypeDef, unknown>) =>
    Object.fromEntries(Object.entries(values).flatMap(([name, value]) => {
      const item = schema.safeParse(value);
      return item.success ? [[name, item.data] as const] : [];
    }));
  for (const { domainId, id, definition } of rows) {
    const parsed = facts.safeParse(definition);
    if (!parsed.success) continue;
    const inDomain = panels.get(domainId) ?? new Map<string, PanelDefinition>();
    const { members, state } = parsed.data.manifest;
    const fields = retained(state, manifest.state.valueSchema);
    for (const [name, field] of Object.entries(fields)) {
      if (field.type.kind === "placement" && field.default != null && !panelPlacementSchema.safeParse(field.default).success)
        fields[name] = { ...field, default: undefined };
    }
    inDomain.set(id, { name: id, manifest: { members: retained(members, manifest.members.valueSchema), state: fields } });
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

async function incompatiblePort(
  source: ReferenceManifest, { wiring }: Reference, definition: PanelDefinition | ProjectionDefinition,
  readCatalogue = readPanelComponentCatalogue, domainId: string | null = null, client?: QueryClient,
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
  if ("data" in definition && wiring.listColumn !== undefined && Object.keys(definition.data).length > 0) {
    return "listColumn members cannot declare independent data reads";
  }
  for (const [name, value] of Object.entries(wiring.inputs ?? {})) {
    const type = target.inputs[name];
    if (!type && "state" in value && implicit.has(name)) continue;
    if (!type) return `input '${name}' was removed or is not exposed`;
    // The view supplies a repeated row or row field as an input; the read/operation boundary checks its value against this port.
    if ("item" in value || "itemField" in value) continue;
    const offered = "state" in value ? source.state[value.state]?.type : undefined;
    if (!("literal" in value) && offered === undefined) return `input '${name}' has no declared value source`;
    const accepts = "literal" in value ? type.kind === "json" || matchesDirectPanelValue(type, value.literal)
      : offered !== undefined && directProjectionInputAccepts(type, offered);
    if (!accepts) return `input '${name}' does not accept its connected value`;
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
      if (!missingRequiredReadParameters(declaration, datum.params, undefined, wiring).length) continue;
      const component = await readProjectionComponent(definition.componentId, readCatalogue, domainId, client);
      const runtimeParams = appsSdkComponentDatum(component?.data, name)?.runtimeParams;
      const [missing] = missingRequiredReadParameters(declaration, datum.params, runtimeParams, wiring);
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
  const [panels, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  let catalogue: ReturnType<typeof readPanelComponentCatalogue> | undefined;
  const readCatalogue = () => catalogue ??= readPanelComponentCatalogue();
  let checkOperationTarget: ReturnType<typeof panelOperationTargetCheck> | undefined;
  if ("componentId" in input && input.operations) {
    checkOperationTarget = (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
    const issue = await checkOperationTarget(input);
    if (issue) throw new HttpError(400, `Projection '${id}': ${issue}`, "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const checkMember = async (manifest: ReferenceManifest, reference: Reference, definition: PanelDefinition | ProjectionDefinition) => {
    if ("componentId" in definition && definition.operations) {
      checkOperationTarget ??= (await import("./type-table")).panelOperationTargetCheck(owner, credentials);
      const issue = await checkOperationTarget(definition, reference.wiring);
      if (issue) return issue;
    }
    return incompatiblePort(manifest, reference, definition, readCatalogue, isBuiltinProductId(reference.target.id) ? null : owner.domainId, client);
  };
  if ("manifest" in input) panels.set(id, input);
  const saved = await loadSavedPlacements(owner.domainId, panels, client);
  if ("manifest" in input) {
    rejectCycles(panels, details, [id]);

    const inspected = new Map<string, PanelDefinition | ProjectionDefinition>();
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
      const definition = known ?? (target.kind === "panel" ? panels.get(target.id)! : projectionDefinition(target.id, stored));
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
  owner: ProductOwner, viewer: AssistantCredentials, panel: Pick<PanelDefinition, "manifest">, ancestors: ReadonlySet<string>,
  field: string, placement: PanelPlacement, client: PoolClient,
) {
  const target = fixedTarget(placement.target);
  const [panels, details] = await Promise.all([loadPanels(owner.domainId, client), loadDetails(owner.domainId, client)]);
  await requireProductGrant(target.id, "use", viewer);
  const definition = target.kind === "panel" ? panels.get(target.id) : await requireProjection(owner.domainId, target.id, client);
  if (!definition) throw new HttpError(404, "Selected member does not exist", "PRODUCT_UNAVAILABLE");

  const issue = await incompatiblePort(panel.manifest, { key: field, target, wiring: placement }, definition, undefined,
    isBuiltinProductId(target.id) ? null : owner.domainId, client);
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
    for (const reference of collectReferences(panel, details)) {
      const { target, key } = reference;
      const definition = target.kind === "panel" ? panels.get(target.id) : projections.get(target.id);
      if (!definition) throw new Error(`Platform panel '${id}', member '${key}' refers to missing ${target.kind} '${target.id}'`);
      const issue = "componentId" in definition ? await checkOperationTarget(definition, reference.wiring) : undefined;
      const incompatible = issue ?? await incompatiblePort(panel.manifest, reference, definition, readCatalogue);
      if (incompatible) throw new Error(`Platform panel '${id}', member '${key}': ${incompatible}`);
      // A platform panel ships to every language: the opening sentence its entry names by key is in each one it declares.
      if ("componentId" in definition) {
        const [missing] = missingEntryMessageKeys([definition.conversationEntry], panel.content.messages);
        if (missing) throw new Error(`Platform panel '${id}', member '${key}': prefillKey '${missing.key}' is not in content.messages (${missing.locale ?? "any locale"})`);
      }
    }
  }
}
