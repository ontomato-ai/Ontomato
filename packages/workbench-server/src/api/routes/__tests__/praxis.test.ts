import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { createPraxisRouter } from "../praxis";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("product Praxis route", () => {
  it("uses the authenticated domain and preserves product query parameters", async () => {
    const seen: Array<{ url?: string; domain?: string }> = [];
    const upstream = express();
    upstream.get("/runs", (request, response) => {
      seen.push({
        url: request.originalUrl,
        domain: request.header("x-ontomato-domain-id"),
      });
      response.json([]);
    });
    const upstreamBase = await listen(upstream);
    const app = express();
    app.use((request: Request, _response: Response, next: NextFunction) => {
      Object.assign(request, {
        userId: "user-a",
        domainId: "domain-a",
        roles: ["user"],
        token: "token-a",
        apiKey: "",
        locale: "zh-CN",
      });
      next();
    });
    app.use("/api/praxis", createPraxisRouter(upstreamBase));
    const base = await listen(app);

    const response = await fetch(
      `${base}/api/praxis/runs?domainId=domain-a&status=waiting`,
      { headers: { tk: "token-a" } },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { url: "/runs?status=waiting", domain: "domain-a" },
    ]);
  });

  it("rejects a forged domain and hides unsupported Praxis routes", async () => {
    let upstreamCalls = 0;
    const upstream = express();
    upstream.use((_request, response) => {
      upstreamCalls += 1;
      response.json([]);
    });
    const upstreamBase = await listen(upstream);
    const app = express();
    app.use((request: Request, _response: Response, next: NextFunction) => {
      Object.assign(request, {
        userId: "user-a",
        domainId: "domain-a",
        roles: ["user"],
        token: "token-a",
        apiKey: "",
        locale: "zh-CN",
      });
      next();
    });
    app.use("/api/praxis", createPraxisRouter(upstreamBase));
    const base = await listen(app);

    const forged = await fetch(
      `${base}/api/praxis/runs?domainId=domain-b`,
      { headers: { tk: "token-a" } },
    );
    expect(forged.status).toBe(403);

    const hidden = await fetch(`${base}/api/praxis/health`);
    expect(hidden.status).toBe(404);
    expect(upstreamCalls).toBe(0);
  });

  it("passes a preview's identity to Praxis only when it starts a workflow run", async () => {
    const seen: string[] = [];
    const upstream = express();
    upstream.use((request, response) => {
      seen.push(`${request.method} ${request.path} ${request.header(EXECUTION_CONTEXT_HEADER) ?? "-"}`);
      response.json({});
    });
    const upstreamBase = await listen(upstream);
    const app = express();
    app.use(express.json());
    app.use((request: Request, _response: Response, next: NextFunction) => {
      Object.assign(request, { userId: "user-a", domainId: "domain-a", roles: ["user"], token: "token-a", apiKey: "", locale: "en" });
      next();
    });
    app.use("/api/praxis", createPraxisRouter(upstreamBase));
    const base = await listen(app);
    const send = (path: string, method: string, marker: string) => fetch(`${base}/api/praxis/${path}`, {
      method, headers: { tk: "token-a", "Content-Type": "application/json", [EXECUTION_CONTEXT_HEADER]: marker },
      ...(method === "GET" ? {} : { body: "{}" }),
    });

    await send("runs", "POST", previewExecutionContextHeader);
    await send("runs", "POST", '{"kind":"live"}');
    await send("runs", "GET", previewExecutionContextHeader);
    await send("runs/r-1/tick", "POST", previewExecutionContextHeader);
    expect(seen).toEqual([`POST /runs ${previewExecutionContextHeader}`, "POST /runs -", "GET /runs -", "POST /runs/r-1/tick -"]);
  });
});

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
