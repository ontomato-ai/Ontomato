#!/usr/bin/env node
// Registers this trial on a running platform: the projections, then the two panels, then the two applications that use
// them. Run it where the workspace's TypeScript loader is available, because it checks every body against the contracts:
//
//   node --import tsx packages/apps-sdk/examples/panels/schedules-trial/register.mjs \
//     --base https://host/wenshu --token <credential>          # or --token-file <path>
//
// The credential is read from the argument or the file and never written into a file of this repository or printed.
// Every body is the contracts' own shape, so a body the platform would refuse fails here first.
import { readFileSync } from "node:fs";
import {
  productPanelInputSchema,
  productProjectionInputSchema,
  registerApplicationPanelUsesRequestSchema,
} from "@ontomato/contracts/product-panels";
import { panelContent, panels, projections, applications } from "./definitions.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]?.startsWith("--") ? "" : all[index + 1]]);
    return pairs;
  }, []),
);
if (!args.base) throw new Error("usage: node register.mjs --base <platform url> --token <token> | --token-file <path>");
const base = args.base.replace(/\/+$/, "");
const token = args.token ?? (args["token-file"] ? readFileSync(args["token-file"], "utf8").trim() : "");
if (!token) throw new Error("A credential is required: --token or --token-file");

async function call(method, path, body, { missing } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", tk: token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const answer = text ? JSON.parse(text) : null;
  if (response.ok) return answer;
  // A definition that does not exist yet is the ordinary first run, not a failure; anything else is.
  if (missing && response.status === 404 && answer?.error?.code === missing) return null;
  throw new Error(`${method} ${path} failed: ${response.status} ${answer?.error?.message ?? text}`);
}

/** Creates a product at revision 0, or replaces it at the revision it has now: the same call either way. */
async function put(path, input) {
  const current = await call("GET", path, undefined, { missing: "PRODUCT_UNAVAILABLE" });
  const revision = current?.projection?.revision ?? current?.panel?.revision ?? 0;
  return call("PUT", path, { ...input, revision });
}

for (const { id, input } of projections) {
  productProjectionInputSchema.parse(input);
  await put(`/api/product-projections/${encodeURIComponent(id)}`, input);
  console.log(`projection ${id}`);
}

for (const panel of panels) {
  const input = {
    name: panel.name,
    description: panel.description,
    visibility: "domain",
    content: panelContent(panel.directory),
    manifest: panel.manifest,
  };
  productPanelInputSchema.parse(input);
  await put(`/api/product-panels/${encodeURIComponent(panel.id)}`, input);
  console.log(`panel ${panel.id}`);
}

for (const { applicationId, ...application } of applications) {
  // The application ID is the path's; the body carries its entry, its metadata and its use relations.
  const request = registerApplicationPanelUsesRequestSchema.parse(application);
  const answer = await call("PUT", `/api/data-query/platform/applications/${encodeURIComponent(applicationId)}/panel-uses`, request);
  console.log(`application ${applicationId}: ${answer?.data?.panelUses?.length ?? 0} use relations`);
}
