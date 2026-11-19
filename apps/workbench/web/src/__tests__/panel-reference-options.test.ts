import { expect, it, vi } from "vitest";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { mcpServiceOptionAdapters } from "../../../../../packages/apps-sdk/src/panel/mcp-service-option";
import { modelOptionAdapters } from "../../../../../packages/apps-sdk/src/panel/model-option";
import { ontologyMetadataAdapters } from "../../../../../packages/apps-sdk/src/panel/ontology-metadata";
import { skillAdapters } from "../../../../../packages/apps-sdk/src/panel/skill";
import { userAdapters } from "../../../../../packages/apps-sdk/src/panel/user";
import type { PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { platformResources } from "../../../../../packages/apps-sdk/src/resources";

const json = (body: unknown): PlatformRequests => ({ request: async () => Response.json(body) });

it("resolves nullable model choices in input order, including missing and repeated values", async () => {
  const [adapter] = modelOptionAdapters(json({ data: {
    models: [{ ref: "provider/chat", type: "chat", name: "Chat" }],
    defaultModelId: "provider/chat", embeddingModelId: null,
  } }));
  const values = [null, "provider/retired", "provider/chat", null, "provider/chat"];
  const resolved = await adapter!.options!.resolve(values);
  expect(resolved.map(option => option.value)).toEqual(values);
  expect(resolved[0]).toMatchObject({ label: "agents.useDomainDefault" });
  expect(resolved[1]).toMatchObject({ unavailable: { reason: "assistant.unavailable" } });
  expect(resolved[2]).toMatchObject({ label: "Chat" });
});

it("resolves each user choice and keeps the owner's reason for an unavailable member", async () => {
  const request = vi.fn(async (path: string) => {
    const id = new URLSearchParams(path.split("?")[1]).get("selected");
    const available = id === "active";
    return Response.json({
      canSetExecutionUser: false, users: [],
      selected: { id, name: "Member", available, ...(id === "former" ? { reason: "not-member" } : {}) },
    });
  });
  const [adapter] = userAdapters({ request });
  const values = ["former", null, "active", "unknown", "former"];
  const resolved = await adapter!.options!.resolve(values);
  expect(resolved.map(option => option.value)).toEqual(values);
  expect(resolved[0]).toMatchObject({ unavailable: { reason: "agents.executionReason.not-member" } });
  expect(resolved[1]).toMatchObject({ label: "agents.executionOwn" });
  expect(resolved[2]).not.toHaveProperty("unavailable");
  expect(resolved[3]).toMatchObject({ unavailable: { reason: "agents.executionReasonUnknown" } });
  expect(request).toHaveBeenCalledTimes(4);
});

it("keeps held skills, MCP services and object types in order when their catalogues omit a value", async () => {
  const active = { name: "active", namespace: { kind: "provider", provider: "workbench" } };
  const removed = { ...active, name: "removed" };
  const service = "ad4c9a59-bab6-4373-bfcf-198d3230e851";
  const missingService = "ad4c9a59-bab6-4373-bfcf-198d3230e852";
  const [skills] = skillAdapters(json({ skills: [{ skill: active, title: "Active skill", description: "" }] }));
  const [services] = mcpServiceOptionAdapters(json([{ id: service, name: "Active service" }]));
  const [classes] = ontologyMetadataAdapters(json({ success: true, data: { classDef: [{ className: "Order" }] } }));
  for (const [adapter, values] of [
    [skills, [removed, active, removed]],
    [services, [missingService, service, missingService]],
    [classes, ["Legacy", "Order", "Legacy"]],
  ] as const) {
    const resolved = await adapter!.options!.resolve(values);
    expect(resolved.map(option => option.value)).toEqual(values);
    expect(resolved[0]).toMatchObject({ unavailable: { reason: "assistant.unavailable" } });
    expect(resolved[1]).not.toHaveProperty("unavailable");
  }
});

it("reads all three metadata bindings through one owner request and preserves relationship endpoints as fields", async () => {
  const request = vi.fn(async () => Response.json({
    success: true, data: {
      classDef: [{ className: "Order", attrs: [{ name: "number" }] }, { className: "Customer" }],
      relationship_rule: { placedBy: { fromclass: "Order", toclass: "Customer" } },
    },
  }));
  const factory = await platformResources.objects[ATTRIBUTE]!();
  const metadata = new Map(factory({ request }).map(adapter => [adapter.objectType, adapter]));
  const [classes, attributes, relationships] = await Promise.all(
    [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP].map(type => metadata.get(type)!.list!()),
  );
  expect(classes?.map(record => record.primaryKey)).toEqual(["Order", "Customer"]);
  expect(attributes?.[0]?.fields).toEqual({ className: "Order", name: "number" });
  expect(relationships).toEqual([{
    primaryKey: "placedBy", label: "placedBy", fields: { fromclass: "Order", toclass: "Customer" },
  }]);
  expect(request.mock.calls).toEqual([["/admin/getMetas", { method: "POST", body: "{}" }, "/data-query"]]);
});
