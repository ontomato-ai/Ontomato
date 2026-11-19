import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { readCurrentAppSdkComponents } from "../../../services/app-builder/sdk";
import { mountAppsSdkStatic } from "../apps-sdk";
import { appBuilderRouter } from "../app-builder";

const VERSION = "1.2.3";
const OLD_VERSION = "1.2.2";
const DIGEST = "a1".repeat(32);
const PUBLIC_PREFIX = "/wenshu";
const SDK_MANIFEST = {
  version: VERSION,
  entries: { "@ontomato/sdk/panel": "panel.js" },
  stylesheet: "styles/sdk.css",
  components: "catalogue/components.json",
};
const COMPONENTS = { version: VERSION, components: [{ componentId: "ObjectList", meaning: "Lists objects." }] };
const PANEL_JS = Buffer.from("export const panel = 'panel';\n");
const STYLESHEET = Buffer.from("body { color: red; }\n");
const ENTRY = Buffer.from(`${JSON.stringify({ version: VERSION })}\n`);
let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "apps-sdk-static-"));
  installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: root });
  const installed = path.join(root, "data", "apps-sdk");
  const versionRoot = path.join(installed, VERSION);
  mkdirSync(path.join(versionRoot, "styles"), { recursive: true });
  writeFileSync(path.join(versionRoot, "panel.js"), PANEL_JS);
  writeFileSync(path.join(versionRoot, "panel.js.br"), brotliCompressSync(PANEL_JS));
  writeFileSync(path.join(versionRoot, "panel.js.gz"), gzipSync(PANEL_JS));
  writeFileSync(path.join(versionRoot, "styles/sdk.css"), STYLESHEET);
  writeFileSync(path.join(versionRoot, "styles/sdk.css.gz"), gzipSync(STYLESHEET));
  writeFileSync(path.join(versionRoot, "notes.txt"), "plain\n");
  writeFileSync(path.join(installed, "current.json"), ENTRY);
  mkdirSync(path.join(versionRoot, "catalogue"));
  writeFileSync(path.join(versionRoot, "sdk.json"), JSON.stringify(SDK_MANIFEST));
  writeFileSync(path.join(versionRoot, SDK_MANIFEST.components), JSON.stringify(COMPONENTS));
  const buildRoot = path.join(root, "dist/apps-sdk");
  mkdirSync(buildRoot, { recursive: true });
  writeFileSync(path.join(buildRoot, "current.json"), JSON.stringify({ version: VERSION, digest: DIGEST }));

  const oldRoot = path.join(installed, OLD_VERSION);
  mkdirSync(oldRoot);
  writeFileSync(path.join(oldRoot, "sdk.json"), JSON.stringify({ version: OLD_VERSION }));
  writeFileSync(path.join(oldRoot, "panel.js"), "export const legacy = true;\n");

  vi.stubEnv("PUBLIC_BASE_PATH", PUBLIC_PREFIX);
  const workbench = express();
  workbench.use("/api", appBuilderRouter);
  mountAppsSdkStatic(workbench);
  const gateway = express();
  gateway.use(PUBLIC_PREFIX, workbench);
  gateway.use(workbench);
  server = createServer(gateway);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function get(pathname: string, acceptEncoding?: string) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const request_ = request({ host: "127.0.0.1", port, path: pathname, headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request_.on("error", reject);
    request_.end();
  });
}

function expectCommonHeaders(headers: IncomingHttpHeaders) {
  expect(headers.vary).toBe("Accept-Encoding");
  expect(headers["access-control-allow-origin"]).toBe("*");
  expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
}

describe("current apps SDK discovery", () => {
  it("discovers the installed package and its catalogue with the deployment prefix", async () => {
    const response = await get(`${PUBLIC_PREFIX}/api/apps-sdk/current`);
    expect(response.status).toBe(200);
    const sdkBasePath = `${PUBLIC_PREFIX}/apps-sdk/${VERSION}`;
    const current = JSON.parse(response.body.toString());
    expect(current).toEqual({
      version: VERSION,
      digest: DIGEST,
      publicBasePath: PUBLIC_PREFIX,
      sdkBasePath,
      manifestPath: `${sdkBasePath}/sdk.json`,
      componentsPath: `${sdkBasePath}/${SDK_MANIFEST.components}`,
      docsPath: `${sdkBasePath}/docs/index.md`,
      referencePath: `${sdkBasePath}/docs/reference.md`,
    });
    const manifest = await get(current.manifestPath);
    const catalogue = await get(current.componentsPath);
    expect(manifest.status).toBe(200);
    expect(catalogue.status).toBe(200);
    expect(JSON.parse(manifest.body.toString())).toEqual(SDK_MANIFEST);
    expect(JSON.parse(catalogue.body.toString())).toEqual(COMPONENTS);
    expect(await readCurrentAppSdkComponents()).toEqual({ version: VERSION, digest: DIGEST, catalogue: COMPONENTS });

    const oldModule = await get(`${PUBLIC_PREFIX}/apps-sdk/${OLD_VERSION}/panel.js`);
    expect(oldModule.status).toBe(200);
    expect(oldModule.body.toString()).toBe("export const legacy = true;\n");
    expectCommonHeaders(oldModule.headers);
  });
});

describe("apps SDK static delivery", () => {
  it("serves Brotli when the browser accepts it", async () => {
    const response = await get(`/apps-sdk/${VERSION}/panel.js`, "gzip, deflate, br");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expectCommonHeaders(response.headers);
    expect(brotliDecompressSync(response.body)).toEqual(PANEL_JS);
  });

  it("serves gzip when Brotli is not accepted", async () => {
    const response = await get(`/apps-sdk/${VERSION}/panel.js`, "gzip, deflate");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expectCommonHeaders(response.headers);
    expect(gunzipSync(response.body)).toEqual(PANEL_JS);
  });

  it("serves the original bytes without Accept-Encoding", async () => {
    const response = await get(`/apps-sdk/${VERSION}/panel.js`);
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expectCommonHeaders(response.headers);
    expect(response.body).toEqual(PANEL_JS);
  });

  it("falls back to gzip for a file without a Brotli sibling", async () => {
    const response = await get(`/apps-sdk/${VERSION}/styles/sdk.css`, "br, gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-type"]).toMatch(/text\/css/);
    expectCommonHeaders(response.headers);
    expect(gunzipSync(response.body)).toEqual(STYLESHEET);
  });

  it("serves the original file when no compressed sibling exists", async () => {
    const response = await get(`/apps-sdk/${VERSION}/notes.txt`, "br, gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    expectCommonHeaders(response.headers);
    expect(response.body.toString()).toBe("plain\n");
  });

  it("keeps the unversioned entry file revalidatable", async () => {
    const response = await get("/apps-sdk/current.json", "br, gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["cache-control"]).toBe("public, max-age=0");
    expect(response.body).toEqual(ENTRY);
  });

  it("does not let a browser keep a missing file: only a file that is sent carries the long cache and its type", async () => {
    // A path asked for before its version is installed, or a mistyped one, must be asked for again next time.
    const response = await get(`/apps-sdk/${VERSION}/missing.js`, "br, gzip");
    expect(response.status).toBe(404);
    expect(response.headers["cache-control"]).toBeUndefined();
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-type"]).not.toMatch(/javascript/);
  });
});
