#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  productPanelInputSchema,
  productProjectionInputSchema,
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

  if (mode === "snapshot") {
    const entries = [];
    for (const { id } of panels) entries.push([id, await client.currentRevision("panel", id)]);
    console.log(JSON.stringify(Object.fromEntries(entries), null, 2));
    return;
  }

  const creating = mode === "create";
  const expected = creating ? {} : JSON.parse(revisions.startsWith("@") ? readFileSync(revisions.slice(1), "utf8") : revisions);
  const panelItems = panels.map(({ id, directory, name, description, manifest }) => ({
    id, mode, revision: expected[id],
    input: productPanelInputSchema.parse({
      name, description, visibility: "domain", content: panelContent(directory), manifest, sdkVersion,
    }),
  }));
  await client.register({
    // Existing projections already back the trial. Re-registration changes only the versioned panel records and routes.
    projections: creating ? projections.map(({ id, input }) => ({ id, mode, input: productProjectionInputSchema.parse(input) })) : [],
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
