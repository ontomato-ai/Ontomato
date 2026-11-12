import { personalWorkspaceSchema } from "@ontomato/contracts/personal-workspace";
import type { WorkspaceObjectHost, WorkspaceObjectReference } from "@ontomato/contracts/workspace-objects";
import { nodeApiRequest } from "@ontomato/workbench-ui";

const same = (a: WorkspaceObjectReference, b: WorkspaceObjectReference) => a.className === b.className && a.primaryKey === b.primaryKey;
async function request(init?: RequestInit) {
  const response = await nodeApiRequest("/api/personal-workspace", init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return personalWorkspaceSchema.parse(body.data);
}
export function createWorkspaceObjectHost(): WorkspaceObjectHost {
  return {
    async isPinned(reference) { return (await request()).pinnedObjects.some(item => same(item, reference)); },
    async toggle(reference) {
      const config = await request();
      const exists = config.pinnedObjects.some(item => same(item, reference));
      const next = { ...config, pinnedObjects: exists ? config.pinnedObjects.filter(item => !same(item, reference)) : [...config.pinnedObjects, reference] };
      const saved = await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(personalWorkspaceSchema.parse(next)) });
      return saved.pinnedObjects.some(item => same(item, reference));
    },
  };
}
