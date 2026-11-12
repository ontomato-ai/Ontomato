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
  const written = (owner:string) => query.mock.calls
    .filter(([sql]) => sql.startsWith(`UPDATE ${owner} `))
    .map(([, params]) => params as string[])
    .map(([after, domain, before]) => ({ after: JSON.parse(after!), domain, before: JSON.parse(before!) }));
  expect(query.mock.calls.filter(([sql]) => sql.startsWith("SELECT")).every(([sql]) => sql.includes("NOT model_reference_migrated"))).toBe(true);
  for (const owner of ["assistant_agents","ops_diagnosis_settings"])
    expect(written(owner)).toEqual(expect.arrayContaining([
      { after:{modelId:"gateway/chat"}, domain:"d", before:{modelId:"main"} },
      { after:{modelId:"legacy/missing"}, domain:"d", before:{modelId:"missing"} },
      { after:{modelId:null}, domain:"d", before:{modelId:null} },
      { after:{modelId:"gateway/slashed"}, domain:"d", before:{modelId:"old/name"} },
    ]));
});

import { modelSelectionView } from "@ontomato/contracts/model-selection";
it("agent choices exclude embedding models and keep explicit unavailable references", () => {
  const view = modelSelectionView("gateway/embed", [
    { ref: "gateway/chat", name: "Chat", type: "chat" },
    { ref: "gateway/embed", name: "Embedding", type: "embedding" },
  ], { nullChoice: "Default", unavailable: ref => `Unavailable: ${ref}` });
  expect(view.missingId).toBe("gateway/embed");
  expect(view.options.map(({ value, disabled }) => ({ value, disabled }))).toEqual([
    { value: "", disabled: false },
    { value: "gateway/chat", disabled: false },
    { value: "gateway/embed", disabled: true },
  ]);
});
