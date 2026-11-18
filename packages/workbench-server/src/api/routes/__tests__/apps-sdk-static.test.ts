import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { mountAppsSdkStatic } from "../apps-sdk";

const VERSION = "1.2.3";
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
  const app = express();
  mountAppsSdkStatic(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
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
});
