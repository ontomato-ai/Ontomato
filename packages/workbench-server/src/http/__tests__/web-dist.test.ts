import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../content/layout";
import { mountWebDist } from "../web-dist";

const INDEX = Buffer.from("<!doctype html><title>workbench</title>\n");
const ASSET = Buffer.from("export const asset = 'asset';\n");
let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "web-dist-"));
  installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: root });
  const webRoot = path.join(root, "dist", "web");
  mkdirSync(path.join(webRoot, "assets"), { recursive: true });
  writeFileSync(path.join(webRoot, "index.html"), INDEX);
  writeFileSync(path.join(webRoot, "assets", "app.js"), ASSET);
  const app = express();
  mountWebDist(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

function requestDist(method: "GET" | "HEAD", pathname: string, headers?: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const request_ = request({ host: "127.0.0.1", port, method, path: pathname, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request_.on("error", reject);
    request_.end();
  });
}

function get(pathname: string, headers?: Record<string, string>) {
  return requestDist("GET", pathname, headers);
}

describe("the production web mount", () => {
  it("serves the entry page and the built assets from the dist", async () => {
    const entry = await get("/");
    expect(entry.status).toBe(200);
    expect(entry.body.equals(INDEX)).toBe(true);
    const asset = await get("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.body.equals(ASSET)).toBe(true);
  });

  it("disables caching on index.html and shell redirects while keeping long cache on hashed assets", async () => {
    for (const pathname of ["/", "/index.html"]) {
      for (const method of ["GET", "HEAD"] as const) {
        const res = await requestDist(method, pathname);
        expect(res.status, `${method} ${pathname}`).toBe(200);
        expect(res.headers["cache-control"], `${method} ${pathname}`).toBe("no-cache, no-store");
      }
    }

    const shellRedirect = await get("/applications/app-panels-trial-a");
    expect(shellRedirect.status).toBe(302);
    expect(shellRedirect.headers["cache-control"]).toBe("no-cache, no-store");

    const asset = await get("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("redirects a deep page address to the same path and query behind the fragment", async () => {
    const deep = await get("/applications/app-panels-trial-a");
    expect(deep.status).toBe(302);
    expect(deep.headers.location).toBe("/#/applications/app-panels-trial-a");
    const withQuery = await get("/applications/app-panels-trial-a?panel=metrics");
    expect(withQuery.status).toBe(302);
    expect(withQuery.headers.location).toBe("/#/applications/app-panels-trial-a?panel=metrics");
  });

  it("keeps a forwarded gateway base path in the redirect", async () => {
    const prefixed = await get("/agents/chat", { "x-forwarded-prefix": "/sub" });
    expect(prefixed.status).toBe(302);
    expect(prefixed.headers.location).toBe("/sub/#/agents/chat");
  });

  it("redirects a page address whose last segment merely contains a dot", async () => {
    const dotted = await get("/agents/settings/claude-3.5-sonnet");
    expect(dotted.status).toBe(302);
    expect(dotted.headers.location).toBe("/#/agents/settings/claude-3.5-sonnet");
  });

  it("answers 404, not the page HTML, for missing file requests", async () => {
    for (const pathname of ["/applications/assets/app.js", "/applications/config.js", "/assets/missing.js"]) {
      const miss = await get(pathname);
      expect(miss.status).toBe(404);
      expect(miss.body.equals(INDEX)).toBe(false);
    }
  });
});
