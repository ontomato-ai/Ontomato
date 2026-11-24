import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
import { clearObjectDetail, setObjectDetail } from "../object-detail-write";

const state = vi.hoisted(() => ({
  assertPermission: vi.fn(), requireGrant: vi.fn(), requirePanel: vi.fn(), validate: vi.fn(), query: vi.fn(),
}));
vi.mock("../../../identity/installed", () => ({ assertPermission: state.assertPermission }));
vi.mock("../../../infrastructure/postgres", () => ({ qualifiedTable: (table: string) => table }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (callback: (client: { query: typeof state.query }) => Promise<void>) => callback({ query: state.query }),
}));
vi.mock("../../../infrastructure/product-write-lock", () => ({ lockProducts: vi.fn() }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: state.requireGrant }));
vi.mock("../object-detail", () => ({ requireDetailPanel: state.requirePanel }));
vi.mock("../references", () => ({ validateObjectDetailPanelMapping: state.validate }));

const owner = { domainId: "domain", userId: "modeler" };
const viewer = { token: "modeling-token" };

beforeEach(() => { vi.resetAllMocks(); });

it("authorizes only the new panel when replacing a binding and needs no panel grant to clear it", async () => {
  state.requireGrant.mockImplementation(async (id, verb) => {
    if (id !== "new" || verb !== "use") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  });
  await setObjectDetail(owner, viewer, "Customer", "new");
  await clearObjectDetail(owner, viewer, "Customer");

  expect(state.assertPermission).toHaveBeenCalledWith(viewer, ["ontology-modeling"]);
  expect(state.requireGrant.mock.calls).toEqual([["new", "use", viewer]]);
  expect(state.validate).toHaveBeenCalledWith(owner.domainId, "Customer", "new", expect.anything());
  expect(state.query.mock.calls).toHaveLength(2);
});

it("performs no mapping write after a modeling or new panel permission refusal", async () => {
  state.assertPermission.mockRejectedValueOnce(new HttpError(403, "Denied", "PERMISSION_DENIED"));
  await expect(clearObjectDetail(owner, viewer, "Customer")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  state.requireGrant.mockRejectedValueOnce(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  await expect(setObjectDetail(owner, viewer, "Customer", "new")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(state.query).not.toHaveBeenCalled();
  expect(state.validate).not.toHaveBeenCalled();
});
