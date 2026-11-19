#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  directPanelInputSchema,
  directProjectionInputSchema,
  productPanelInputSchema,
  registerApplicationPanelUsesRequestSchema,
} from "@ontomato/contracts/product-panels";
import { panelRegistrationClient } from "../../../../../agent-skills/ontomato-app-builder/panel-registration.mjs";
import { panelContent, panels, projections, applications } from "./definitions.mjs";

async function main() {
  const { values: { base, mode, token, "token-file": tokenFile, "sdk-version": sdkVersion, revisions } } = parseArgs({
    options: {
      base: { type: "string" },
      mode: { type: "string" },
      token: { type: "string" },
      "token-file": { type: "string" },
      "sdk-version": { type: "string" },
      revisions: { type: "string" },
    },
  });
  if (!base || !["snapshot", "create", "update"].includes(mode) || (mode !== "snapshot" && !sdkVersion)
    || (mode === "update" && !revisions) || (token !== undefined && tokenFile !== undefined)) {
    throw new Error("Usage: register.mjs --base <url> --mode snapshot|create|update [--token-file <path> | --token <credential>] [--sdk-version <exact version>] [--revisions <json|@file>]");
  }

  const credential = tokenFile === undefined ? token : readFileSync(tokenFile, "utf8").trim();
  const client = panelRegistrationClient({
    workbenchUrl: base.replace(/\/+$/, ""),
    headers: credential ? { tk: credential } : {},
  });

  // The projections and panels this script writes, each with its kind: a snapshot and an update cover the same records.
  const records = [...projections.map(({ id }) => ["projection", id]), ...panels.map(({ id }) => ["panel", id])];
  if (mode === "snapshot") {
    const entries = [];
    for (const [kind, id] of records) entries.push([id, await client.currentRevision(kind, id)]);
    console.log(JSON.stringify(Object.fromEntries(entries), null, 2));
    return;
  }

  const creating = mode === "create";
  const expected = creating ? {} : JSON.parse(revisions.startsWith("@") ? readFileSync(revisions.slice(1), "utf8") : revisions);
  // A panel without code is a direct panel, which names no SDK version; a panel with a module is pinned to the one given.
  const panelItems = panels.map(({ id, directory, name, description, manifest }) => {
    const content = panelContent(directory);
    const definition = { name, description, visibility: "domain", content, manifest };
    return {
      id, mode, revision: expected[id],
      input: content.module === undefined ? directPanelInputSchema.parse(definition) : productPanelInputSchema.parse({ ...definition, sdkVersion }),
    };
  });
  await client.register({
    projections: projections.map(({ id, input }) => ({ id, mode, revision: expected[id], input: directProjectionInputSchema.parse(input) })),
    panels: panelItems,
    applications: applications.map(({ applicationId: id, entry, panelUses, declaration, entryAccess }) => ({
      id, mode,
      input: registerApplicationPanelUsesRequestSchema.parse({
        entry, panelUses, ...(creating ? { declaration, entryAccess } : {}),
      }),
    })),
  }, (kind, id) => console.log(`${kind} ${id}`));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
