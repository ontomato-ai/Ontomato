import { describe, expect, it, vi } from "vitest";
import { bindingKey, clientSends } from "@ontomato/contracts/panel-client-requests";
import { ACTION, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, USER } from "@ontomato/contracts/platform-object-types";
import {
  createPlatformOntologyClient,
  platformOntologyAdapters,
} from "../../../../../packages/apps-sdk/src/panel/platform-ontology";
import type { PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { platformResources } from "../../../../../packages/apps-sdk/src/resources/index";

type PlatformRequestInit = Parameters<PlatformRequests["request"]>[1];

function mockRequests(handler: (path: string, init: PlatformRequestInit, service: "" | "/data-query") => Response | Promise<Response>) {
  const calls: Array<{ method: string; path: string; service: "" | "/data-query"; body?: unknown }> = [];
  const bindings = [
    bindingKey({ kind: "PlatformObjectType", id: ONTOLOGY_TYPE }),
    bindingKey({ kind: "PlatformObjectType", id: ONTOLOGY_RELATION_KIND }),
  ];
  const requests: PlatformRequests = {
    async request(path, init, service) {
      const method = (init.method ?? "GET").toUpperCase();
      // Verify every outgoing call is admitted by contracts/panel-client-requests for these bindings.
      expect(clientSends(bindings, method, service, path), `unadmitted request ${method} ${service}${path}`).toBe(true);
      const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, service, body: parsedBody });
      return handler(path, init, service);
    },
  };
  return { requests, calls };
}

describe("platform-ontology SDK client & adapters", () => {
  it("registers ONTOLOGY_TYPE and ONTOLOGY_RELATION_KIND in platformResources through one shared factory", async () => {
    expect(platformResources.objects[ONTOLOGY_TYPE]).toBeDefined();
    expect(platformResources.objects[ONTOLOGY_RELATION_KIND]).toBe(platformResources.objects[ONTOLOGY_TYPE]);
    const factory = await platformResources.objects[ONTOLOGY_TYPE]!();
    expect(factory).toBe(platformOntologyAdapters);
  });

  it("shares in-flight schema reads and exposes graph schema, counts, start, and neighbors", async () => {
    const schemaPayload = {
      layers: ["fact", "capability", "governance", "product"],
      objectTypes: [
        { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
        { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
      ],
      relationKinds: [
        {
          id: "user.created-action",
          from: USER,
          to: ACTION,
          labelKey: "platformOntology.relations.user.created-action",
          derived: false,
          owner: "java-action",
        },
      ],
    };

    const { requests, calls } = mockRequests((path) => {
      if (path === "/platform-ontology/schema") return Response.json(schemaPayload);
      if (path === "/platform-ontology/counts") {
        return Response.json({
          counts: [
            { type: USER, layer: "governance", status: "ok", count: 4 },
            { type: ACTION, layer: "capability", status: "refused", reason: "forbidden" },
          ],
        });
      }
      if (path === "/platform-ontology/start") {
        return Response.json({
          node: { className: USER, primaryKey: "u-1" },
          label: "Alice",
          layer: "governance",
        });
      }
      if (path === "/platform-ontology/neighbors") {
        return Response.json({
          node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" },
          neighbors: [{ className: ACTION, primaryKey: "a-1", label: "Approve", layer: "capability" }],
          edges: [
            {
              id: "user.created-action:platform:User:u-1->platform:Action:a-1",
              relationKind: "user.created-action",
              from: { className: USER, primaryKey: "u-1" },
              to: { className: ACTION, primaryKey: "a-1" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "user.created-action", status: "ok", edgeCount: 1 }],
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const [typeAdapter, relationAdapter] = platformOntologyAdapters(requests);
    expect(typeAdapter.objectType).toBe(ONTOLOGY_TYPE);
    expect(relationAdapter.objectType).toBe(ONTOLOGY_RELATION_KIND);

    // Concurrent schema reads coalesce into one HTTP request
    const [types, relations] = await Promise.all([typeAdapter.list!(), relationAdapter.list!()]);
    expect(types.map((t) => t.primaryKey)).toEqual([USER, ACTION]);
    expect(relations.map((r) => r.primaryKey)).toEqual(["user.created-action"]);
    expect(calls.filter((c) => c.path === "/platform-ontology/schema")).toHaveLength(1);

    const counts = await typeAdapter.graph!.counts!();
    expect(counts).toHaveLength(2);
    expect(counts[1]).toMatchObject({ type: ACTION, status: "refused" });

    const startNode = await typeAdapter.graph!.start!();
    expect(startNode).toEqual({
      className: USER,
      primaryKey: "u-1",
      label: "Alice",
      layer: "governance",
    });

    const neighbors = await typeAdapter.graph!.neighbors({
      node: { className: USER, primaryKey: "u-1" },
      layers: ["governance", "capability"],
    });
    expect(neighbors.neighbors).toHaveLength(1);
    expect(neighbors.edges[0].derived).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/platform-ontology/neighbors",
      service: "",
      body: { node: { className: USER, primaryKey: "u-1" }, layers: ["governance", "capability"] },
    });
  });

  it("queries objects of a dynamically selected objectType via /platform-ontology/objects and preserves distinct status/reason", async () => {
    const handler = vi.fn((path: string, init: PlatformRequestInit) => {
      if (path === "/platform-ontology/objects") {
        const body = JSON.parse(String(init.body));
        if (body.type === ACTION) {
          return Response.json({
            type: ACTION,
            layer: "capability",
            status: "ok",
            items: [{ node: { className: ACTION, primaryKey: "a-2" }, label: "Refund", detail: "refund_order" }],
            total: 12,
            page: body.page,
            pageSize: body.pageSize,
          });
        }
        if (body.type === USER) {
          return Response.json({
            type: USER,
            layer: "governance",
            status: "refused",
            reason: "Missing directory permission",
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
          });
        }
      }
      return new Response(JSON.stringify({ error: "Upstream unavailable" }), { status: 502 });
    });

    const { requests, calls } = mockRequests(handler);
    const [typeAdapter] = platformOntologyAdapters(requests);

    const page2 = await typeAdapter.query!({
      objectType: ACTION,
      search: "ref",
      page: { offset: 10, limit: 10 },
    });
    expect(page2).toEqual({
      items: [
        {
          primaryKey: "a-2",
          className: ACTION,
          label: "Refund",
          subtitle: "refund_order",
          fields: { className: ACTION, primaryKey: "a-2", detail: "refund_order" },
        },
      ],
      total: 12,
      status: "ok",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/platform-ontology/objects",
      body: { type: ACTION, keyword: "ref", page: 2, pageSize: 10 },
    });

    const refused = await typeAdapter.query!({ objectType: USER });
    expect(refused).toEqual({
      items: [],
      total: 0,
      status: "refused",
      reason: "Missing directory permission",
    });

    const client = createPlatformOntologyClient(requests);
    await expect(client.counts()).rejects.toThrow("Upstream unavailable");
  });
});
