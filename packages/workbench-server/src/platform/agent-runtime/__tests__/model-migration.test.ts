import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query }), qualifiedTable: (s:string) => s }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({ RuntimeClient: class { request = request; } }));
import { migrateWorkbenchModels } from "../model-migration";
it("rewrites both owners with CAS and preserves null and provider/model references", async () => {
  request.mockResolvedValue({ references:{main:"gateway/chat","old/name":"gateway/slashed"},unconfiguredProviderId:"legacy" });
  query.mockImplementation(async (sql:string) => sql.startsWith("SELECT DISTINCT domain_id") ? {rows:[{domain_id:"d"}]} : sql.startsWith("SELECT DISTINCT model_selection")
    ? {rows:[{model_selection:{modelId:"main"}},{model_selection:{modelId:"missing"}},{model_selection:{modelId:null}},{model_selection:{modelId:"old/name"}}]} : {rows:[]});
  await migrateWorkbenchModels();
  const updates = query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"));
  expect(updates).toHaveLength(8);
  expect(updates[0]![1]).toEqual(['{"modelId":"gateway/chat"}',"d",'{"modelId":"main"}']);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith("SELECT")).every(([sql]) => sql.includes("NOT model_reference_migrated"))).toBe(true);
  expect(updates[3]![1]).toEqual(['{"modelId":"gateway/slashed"}',"d",'{"modelId":"old/name"}']);
  expect(updates[1]![1]).toEqual(['{"modelId":"legacy/missing"}',"d",'{"modelId":"missing"}']);
});

import { modelSelectionView } from "@ontomato/contracts/model-selection";
it("agent choices exclude embedding models and keep explicit unavailable references", () => {
  const view = modelSelectionView("gateway/embed", [
    { ref: "gateway/chat", name: "Chat", type: "chat" },
    { ref: "gateway/embed", name: "Embedding", type: "embedding" },
  ], { nullChoice: "Default", unavailable: ref => `Unavailable: ${ref}` });
  expect(view.missingId).toBe("gateway/embed");
  expect(view.options).toEqual([
    { value: "", label: "Default", disabled: false },
    { value: "gateway/chat", label: "Chat (gateway/chat)", disabled: false },
    { value: "gateway/embed", label: "Unavailable: gateway/embed", disabled: true },
  ]);
});
