import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelModuleImports } from "@ontomato/contracts/panel-module";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { builtinProductIdSchema } from "@ontomato/contracts/product-record-id";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema,
  productPanelInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { runtimeRoot } from "../../content/layout";
import { qualifiedTable } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { builtinProductTables, type CurrentProductKind } from "../../infrastructure/product-current";
import { readPanelComponentCatalogue, validateProjectionComponent } from "./component-catalogue";
import { validateBuiltinProductReferences } from "./references";
import { platformTypeEntries } from "./type-table";

const workspaceIdentity = z.object({
  panels: z.array(z.object({
    id: builtinProductIdSchema,
    input: productPanelInputSchema.pick({ name: true, description: true }).strip(),
  })).length(1),
});
const indexSchema = z.array(z.string().min(1).refine(directory =>
  !path.isAbsolute(directory) && !directory.split(/[\\/]/u).some(segment => segment === ".." || segment === "." || !segment),
"Expected a relative directory in the platform panel bundle"));

async function optionalText(file: string) {
  try { return await readFile(file, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readBuiltinProducts(root: string) {
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
      const [registration, descriptor, html, module, recipes] = await Promise.all([
        readFile(path.join(directory, "registration.json"), "utf8"),
        readFile(path.join(directory, "panel.json"), "utf8"),
        readFile(path.join(directory, "panel.html"), "utf8"),
        readFile(path.join(directory, "panel.mjs"), "utf8"),
        optionalText(path.join(directory, "recipes.md")),
      ]);
      const { panels: [identity] } = workspaceIdentity.parse(JSON.parse(registration));
      const { content, manifest, ...metadata } = z.object({
        manifest: panelAuthoringManifestSchema,
        content: productPanelInputSchema.shape.content.pick({ messages: true }).strict().optional(),
        template: productPanelInputSchema.shape.template,
        theme: productPanelInputSchema.shape.theme,
      }).strict().parse(JSON.parse(descriptor));
      const { state, members, ...declaration } = manifest;
      await panelModuleImports(module);
      const placements = Object.fromEntries(Object.entries(members).map(([member, definition]) => {
        if (!("component" in definition)) return [member, definition];
        const id = builtinProductIdSchema.parse(definition.id);
        if (projections.has(id)) throw new Error(`Duplicate platform projection '${id}'`);
        const { projection, placement } = expandPanelAuthoringMember(member, definition, { state, components, typeTable });
        projections.set(id, builtinProductProjectionInputSchema.parse({
          ...projection, visibility: "platform", name: definition.name ?? member, description: definition.description ?? member,
        }));
        return [member, { ...placement, target: { projectionId: id } }];
      }));
      const { id, input } = identity!;
      if (panels.has(id)) throw new Error(`Duplicate platform panel '${id}'`);
      panels.set(id, builtinProductPanelInputSchema.parse({
        ...input, ...metadata, visibility: "platform", manifest: { ...declaration, state, members: placements },
        content: { ...content, html, module, ...(recipes === undefined ? {} : { recipes }) },
      }));
    } catch (cause) {
      throw new Error(`Cannot register platform panel directory '${relative}': ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
  for (const [id, projection] of projections) {
    if (panels.has(id)) throw new Error(`Platform product ID '${id}' is declared as a panel and a projection`);
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
  });
}
