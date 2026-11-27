import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AffectedEntryRoot } from "@ontomato/contracts/entry-dependencies";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringInlineMemberSchema, panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelModuleImports } from "@ontomato/contracts/panel-module";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { BUILTIN_PRODUCT_ID_PREFIX, builtinProductIdSchema } from "@ontomato/contracts/product-record-id";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema,
  productPanelInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { runtimeRoot } from "../../content/layout";
import { qualifiedTable } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { builtinProductTables, currentProductTables, type CurrentProductKind } from "../../infrastructure/product-current";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { readPanelComponentCatalogue, validateProjectionComponent } from "./component-catalogue";
import { validateBuiltinProductReferences } from "./references";
import { platformTypeEntries } from "./type-table";
import { declaredProjectionAgents, entryDependencyCompiler } from "./entry-dependency-compiler";
import { compileRegisteredPanelRoots, installBuiltinPanelDependencies, saveBoundEntryDependencies } from "./entry-dependency-store";
import { deliverPendingEntryDependencyPublications, readAffectedEntryRoots } from "./entry-dependency-publication";

const workspaceIdentity = z.object({
  panels: z.array(z.object({
    id: builtinProductIdSchema,
    input: productPanelInputSchema.pick({ name: true, description: true }).strip(),
  })).length(1),
});
const indexSchema = z.array(z.string().min(1).refine(directory =>
  !path.isAbsolute(directory) && !directory.split(/[\\/]/u).some(segment => segment === ".." || segment === "." || !segment),
"Expected a relative directory in the platform panel bundle"));
const projectionFileSchema = z.array(z.object({
  id: builtinProductIdSchema,
  input: z.union([builtinProductProjectionInputSchema, panelAuthoringInlineMemberSchema]),
}).strict());

async function optionalText(file: string) {
  try { return await readFile(file, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readBuiltinProducts(root: string) {
  const index = await optionalText(path.join(root, "index.json"));
  const directories = index === undefined ? [] : indexSchema.parse(JSON.parse(index));
  const panels = new Map<string, BuiltinProductPanelInput>();
  const projections = new Map<string, BuiltinProductProjectionInput>();
  if (!directories.length) return { panels, projections };
  const catalogue = await readPanelComponentCatalogue();
  const readCatalogue = async () => catalogue;
  const components = [...catalogue.components.values()];
  const typeTable = { objectTypes: z.record(platformTypeTableEntrySchema).parse(Object.fromEntries(platformTypeEntries())) };

  for (const relative of directories) {
    const directory = path.join(root, relative);
    try {
      const [registration, descriptor, html, module, recipes, projectionFile] = await Promise.all([
        readFile(path.join(directory, "registration.json"), "utf8"),
        readFile(path.join(directory, "panel.json"), "utf8"),
        readFile(path.join(directory, "panel.html"), "utf8"),
        optionalText(path.join(directory, "panel.mjs")),
        optionalText(path.join(directory, "recipes.md")),
        optionalText(path.join(directory, "projections.json")),
      ]);
      const { panels: [identity] } = workspaceIdentity.parse(JSON.parse(registration));
      const { content, manifest, ...metadata } = z.object({
        manifest: panelAuthoringManifestSchema,
        content: productPanelInputSchema.shape.content.pick({ messages: true }).strict().optional(),
        template: productPanelInputSchema.shape.template,
        theme: productPanelInputSchema.shape.theme,
      }).strict().parse(JSON.parse(descriptor));
      const { state, members, ...declaration } = manifest;
      if (module !== undefined) await panelModuleImports(module);
      const addProjection = (id: string, input: BuiltinProductProjectionInput) => {
        if (projections.has(id)) throw new Error(`Duplicate platform projection '${id}'`);
        projections.set(id, input);
      };
      const expandProjection = (name: string, definition: z.infer<typeof panelAuthoringInlineMemberSchema>) => {
        const { projection, placement } = expandPanelAuthoringMember(name, definition, { state, components, typeTable });
        const input = builtinProductProjectionInputSchema.parse({
          ...projection, visibility: "platform", name: definition.name ?? name, description: definition.description ?? name,
        });
        return { input, placement };
      };
      if (projectionFile !== undefined) {
        for (const { id, input } of projectionFileSchema.parse(JSON.parse(projectionFile))) {
          addProjection(id, "component" in input ? expandProjection(id, input).input : input);
        }
      }
      const placements = Object.fromEntries(Object.entries(members).map(([member, definition]) => {
        if (!("component" in definition)) return [member, definition];
        const id = builtinProductIdSchema.parse(definition.id);
        const { input, placement } = expandProjection(member, definition);
        addProjection(id, input);
        return [member, { ...placement, target: { projectionId: id } }];
      }));
      const { id, input } = identity!;
      if (panels.has(id)) throw new Error(`Duplicate platform panel '${id}'`);
      panels.set(id, builtinProductPanelInputSchema.parse({
        ...input, ...metadata, visibility: "platform", manifest: { ...declaration, state, members: placements },
        content: { ...content, html, ...(module === undefined ? {} : { module }), ...(recipes === undefined ? {} : { recipes }) },
      }));
    } catch (cause) {
      throw new Error(`Cannot register platform panel directory '${relative}': ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
  for (const [id, projection] of projections) {
    if (panels.has(id)) throw new Error(`Platform product ID '${id}' is declared as a panel and a projection`);
    for (const { target, field } of declaredProjectionAgents(projection)) {
      if (target.kind === "id") {
        throw new Error(`Platform projection '${id}' cannot bind a domain object: ${field}.id`);
      }
    }
    await validateProjectionComponent(id, projection, readCatalogue);
  }
  await validateBuiltinProductReferences(panels, projections, readCatalogue);
  return { panels, projections };
}

/** Validate and replace the deployment's complete platform collection before the HTTP server starts. */
export async function registerBuiltinProducts(root = path.join(runtimeRoot(), "dist", "builtin-panels")) {
  const { panels, projections } = await readBuiltinProducts(root);
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('workbench-builtin-products'))");
    const collections: [CurrentProductKind, ReadonlyMap<string, BuiltinProductPanelInput | BuiltinProductProjectionInput>][] = [
      ["projection", projections], ["panel", panels],
    ];
    for (const [kind, definitions] of collections) {
      const table = qualifiedTable(builtinProductTables[kind]);
      const ids = [...definitions.keys()];
      await client.query(
        `INSERT INTO ${table} AS current (id,definition)
         SELECT id,definition::jsonb FROM unnest($1::text[],$2::text[]) AS release(id,definition)
         ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition,revision=current.revision+1,updated_at=now()
         WHERE current.definition IS DISTINCT FROM EXCLUDED.definition`,
        [ids, [...definitions.values()].map(value => JSON.stringify(value))],
      );
      await client.query(`DELETE FROM ${table} WHERE NOT (id=ANY($1::text[]))`, [ids]);
    }
    await installBuiltinPanelDependencies(client, [...panels.keys()]);
  });
}

/** Bootstrap the closure for existing entries. Read only identities until the owner selects the formal roots. */
export async function installRegisteredPanelDependencies() {
  const panels = qualifiedTable(currentProductTables.panel);
  const details = qualifiedTable("product_object_details");
  await transaction(async client => {
    const builtin = await client.query<{ id: string }>(`SELECT id FROM ${qualifiedTable(builtinProductTables.panel)}`);
    const { rows } = await client.query<{ domain_id: string; panel_ids: string[]; detail_panel_ids: string[] }>(
      `SELECT domain_id,
         ARRAY(SELECT id FROM ${panels} p WHERE p.domain_id=domains.domain_id AND NOT starts_with(id,$1)) AS panel_ids,
         ARRAY(SELECT DISTINCT panel_id FROM ${details} d WHERE d.domain_id=domains.domain_id) AS detail_panel_ids
       FROM (SELECT domain_id FROM ${panels} UNION SELECT domain_id FROM ${details}) AS domains
       ORDER BY domain_id`, [BUILTIN_PRODUCT_ID_PREFIX],
    );
    const knownPanels = [...new Set([...builtin.rows.map(({ id }) => id), ...rows.flatMap(row => row.panel_ids)])];
    const entries = knownPanels.length ? await readAffectedEntryRoots(null, knownPanels) : [];
    const scopes = new Map<string, AffectedEntryRoot[]>(rows.map(row => [row.domain_id, []]));
    for (const entry of entries) {
      const scope = entry.domainId ?? "";
      const group = scopes.get(scope) ?? [];
      group.push(entry);
      scopes.set(scope, group);
    }
    const detailPanels = new Map(rows.map(row => [row.domain_id, row.detail_panel_ids]));
    for (const [scope, registeredRoots] of [...scopes].sort(([a], [b]) => a.localeCompare(b))) {
      const domainId = scope || null;
      await lockProducts(client, { domainId: scope });
      const roots = new Set([...(detailPanels.get(scope) ?? []), ...registeredRoots.flatMap(({ roots }) => roots.panelIds)]);
      if (domainId !== null) await compileRegisteredPanelRoots(client, domainId, roots);
      const compile = entryDependencyCompiler(client, domainId);
      for (const { entryId, roots: { boundPanelRoot } } of registeredRoots) {
        if (boundPanelRoot)
          await saveBoundEntryDependencies(client, scope, entryId, boundPanelRoot,
            await compile(boundPanelRoot.panelId, boundPanelRoot.inputs));
      }

    }
  });
  await deliverPendingEntryDependencyPublications();
}
