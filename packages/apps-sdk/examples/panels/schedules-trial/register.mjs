#!/usr/bin/env node
// Registers this trial on a running platform: the projections, then the two panels, then the two applications that use
// them. Run it where the workspace's TypeScript loader is available, because it checks every body against the contracts:
//
//   node --import tsx packages/apps-sdk/examples/panels/schedules-trial/register.mjs \
//     --base https://host/wenshu [--token <credential> | --token-file <path>]
//
// The credential is read from the argument or the file and never written into a file of this repository or printed. It
// may be omitted: the open-source platform has no login token and signs in anonymously, and then no credential header is
// sent at all. Every body is the contracts' own shape, so a body the platform would refuse fails here first.
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
if (!args.base) throw new Error("usage: node register.mjs --base <platform url> [--token <token> | --token-file <path>]");
const base = args.base.replace(/\/+$/, "");
// No credential is the anonymous identity, which the open-source platform accepts; the header is then left out rather
// than sent empty.
const token = args.token ?? (args["token-file"] ? readFileSync(args["token-file"], "utf8").trim() : "");

/**
 * One request. A refusal is reported with the platform's own code: `code` is what tells a caller the definition already
 * exists (`PRODUCT_CONFLICT`) apart from one it may not touch (`PRODUCT_FORBIDDEN`), and the two are not the same answer.
 */
async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { tk: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const answer = text ? JSON.parse(text) : null;
  if (response.ok) return answer;
  const refusal = new Error(`${method} ${path} failed: ${response.status} ${answer?.error?.message ?? text}`);
  refusal.status = response.status;
  refusal.code = answer?.error?.code;
  throw refusal;
}

/**
 * Registers a product: created at revision 0 when nothing holds its ID, replaced at the revision it holds now when
 * something does.
 *
 * Which of the two it is comes from the write, not from a read. A read of an ID nothing holds cannot answer "nothing
 * holds it": the platform checks the use grant before it looks the definition up, and an ID it has never registered has
 * no grant, so a missing definition reads as 403 `PRODUCT_FORBIDDEN` — deliberately, since that is what keeps the
 * endpoint from telling a stranger which IDs exist. The write does say so: a revision-0 create over an occupied ID is
 * refused with 409 `PRODUCT_CONFLICT`, and only then is the current revision read and the write repeated with it.
 */
async function put(path, input) {
  try {
    return await call("PUT", path, { ...input, revision: 0 });
  } catch (refusal) {
    if (refusal.code !== "PRODUCT_CONFLICT") throw refusal;
  }
  const current = await call("GET", path);
  const revision = current?.projection?.revision ?? current?.panel?.revision;
  if (!revision) throw new Error(`GET ${path} answered without a revision, so ${path} cannot be replaced`);
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
