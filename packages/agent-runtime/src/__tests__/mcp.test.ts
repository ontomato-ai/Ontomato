import { createServer, type ServerResponse } from "node:http";
import { expect, it } from "vitest";
import { connectMcp } from "../tools";

it("negotiates SSE only at initialization, keeps headers on both transports and never replays an action", async () => {
  let events: ServerResponse | undefined;
  let initializations = 0;
  let actions = 0;
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(String(req.headers.authorization));
    if (req.url === "/sse" && req.method === "POST") {
      initializations++;
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/sse" && req.method === "GET") {
      events = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: endpoint\ndata: /messages\n\n");
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    if (rpc.method === "tools/call") {
      actions++;
      res.writeHead(503).end("Action response lost");
      return;
    }
    res.writeHead(202).end();
    if (rpc.id === undefined) return;
    const result =
      rpc.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "legacy", version: "1" },
          }
        : {
            tools: [
              {
                name: "side_effect",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
    events!.write(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  let connection: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    connection = await connectMcp(
      [
        {
          id: "c75f007f-de1e-4057-bdc2-8b7983ef94f3",
          name: "Legacy",
          url: `http://127.0.0.1:${address.port}/sse`,
          headers: { authorization: "fixture-header" },
        },
      ],
      "fixture",
      new AbortController().signal,
    );
    expect(connection.tools.map((tool) => tool.name)).toEqual(["side_effect"]);
    await expect(
      connection.tools[0].execute("call", {}, new AbortController().signal),
    ).rejects.toThrow();
    expect(initializations).toBe(1);
    expect(actions).toBe(1);
    expect(seen.every((value) => value === "fixture-header")).toBe(true);
  } finally {
    await connection?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
