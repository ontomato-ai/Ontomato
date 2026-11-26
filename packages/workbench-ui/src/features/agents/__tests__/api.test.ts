import { expect, it, vi } from "vitest";
import { nodeApiGet } from "../../../utils/api";
import { agentDefinitionsApi } from "../api";

vi.mock("../../../utils/api", () => ({ nodeApiGet: vi.fn() }));

it("returns the requested page and leaves its continuation to the caller", async () => {
  const agents = [{ id: "11111111-1111-4111-8111-111111111111", name: "Agent", description: "", icon: null, enabled: true }];
  const page = { agents, nextCursor: "more+rows" };
  vi.mocked(nodeApiGet).mockResolvedValueOnce(page);

  const query = { cursor: "opaque+/cursor&2", limit: 3 };
  await expect(agentDefinitionsApi.list(query)).resolves.toEqual(page);
  const [[request]] = vi.mocked(nodeApiGet).mock.calls;
  const url = new URL(request, "https://workbench.test");
  expect(url.pathname).toBe("/assistant/agent-definitions");
  expect(url.searchParams.get("cursor")).toBe(query.cursor);
  expect(url.searchParams.get("limit")).toBe(String(query.limit));
  expect(nodeApiGet).toHaveBeenCalledTimes(1);
});
