import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
const mocks = vi.hoisted(() => ({ query: vi.fn(), snapshot: vi.fn(), cancel: vi.fn(), delete: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../service", () => ({ assistantService: mocks }));
import { deleteUserAssistantSessions } from "../cleanup";
beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.query.mockResolvedValueOnce({ rows: [{ id: "session", domain_id: "domain" }] }).mockResolvedValue({ rows: [] });
});
it("continues to local deletion when the runtime session was removed by an earlier attempt", async () => {
  mocks.snapshot.mockRejectedValue(new HttpError(404, "missing"));
  await deleteUserAssistantSessions("alice");
  expect(mocks.delete).toHaveBeenCalledWith("session", { userId: "alice", domainId: "domain" });
});
it("does not treat an unavailable runtime as a missing session", async () => {
  mocks.snapshot.mockRejectedValue(new HttpError(503, "unavailable"));
  await expect(deleteUserAssistantSessions("alice")).rejects.toThrow("unavailable");
  expect(mocks.delete).not.toHaveBeenCalled();
});
