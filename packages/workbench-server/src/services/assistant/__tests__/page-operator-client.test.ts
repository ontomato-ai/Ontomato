import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { workbenchServerResourceRoot } from "../../../content/resources";

const execFileAsync = promisify(execFile);
let server: Server;
let baseUrl = "";
let readBody: unknown;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      if (req.url === "/read") readBody = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ready", value: [] }));
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it("defaults omitted read inputs to an empty object before posting", async () => {
  const client = path.join(workbenchServerResourceRoot, "resources/runtime-skills/ontomato-page-operator/client.mjs");
  const request = { source: { kind: "registered", applicationId: "ontology", useId: "ontology-objects" }, memberPath: [{ member: "catalog" }], dataName: "rows" };
  await execFileAsync(process.execPath, [client, "read", JSON.stringify(request)], { env: {
    ...process.env,
    ONTOMATO_PANEL_OPERATIONS_URL: baseUrl,
    ONTOMATO_EXECUTION_CALLBACK: "callback",
    ONTOMATO_RUN_ID: "run",
  } });
  expect(readBody).toMatchObject({ ...request, inputs: {} });
});
