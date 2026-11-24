import { beforeEach, expect, it, vi } from "vitest";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE, PRODUCT_PANEL, SAVE_OBJECT_DETAIL_PANEL } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { createObjectDetailReadAdapter } from "../object-detail-reads";
import { objectDetailOperations } from "../object-detail-operations";
import { clearObjectDetail, setObjectDetail } from "../object-detail-write";
import type { PanelOperationHost } from "../server-operations";

const state = vi.hoisted(() => ({
  permission: vi.fn(), getMapping: vi.fn(), getPanel: vi.fn(), allowed: vi.fn(),
  set: vi.fn(), clear: vi.fn(),
}));
vi.mock("../../../identity/installed", () => ({ assertPermission: state.permission }));
vi.mock("../object-detail", () => ({
  findObjectDetailPanelId: state.getMapping, findDetailPanel: state.getPanel,
}));
vi.mock("../../product-governance/grants", () => ({ productGrantAllowed: state.allowed }));
vi.mock("../object-detail-write", () => ({ setObjectDetail: state.set, clearObjectDetail: state.clear }));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
});
const owner = { domainId: "domain", userId: "reader" };
const credentials = { token: "viewer", locale: "en" };
const adapter = createObjectDetailReadAdapter(owner, credentials);
const actor = { owner, credentials };
const host: PanelOperationHost = {
  initiator: actor, executor: actor, request: vi.fn(), requestWorkbench: vi.fn(), locale: "en",
};
const target = { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Customer" } as const;
const [save, clear] = objectDetailOperations;

beforeEach(() => {
  vi.resetAllMocks();
  state.getMapping.mockResolvedValue("panel-1");
  state.getPanel.mockResolvedValue({ status: "available", panel: { name: "Customer details" } });
  state.allowed.mockResolvedValue(true);
});

it("distinguishes an absent, usable, forbidden or broken mapping", async () => {
  state.getMapping.mockResolvedValueOnce(null);
  expect((await adapter.record("Customer")).outputs).toMatchObject({ configured: false, panelStatus: "unconfigured" });
  expect(await adapter.record("Customer")).toMatchObject({
    fields: { panelId: "panel-1", panelName: "Customer details" },
    outputs: { configured: true, panelStatus: "configured", canConfigure: true },
  });

  state.allowed.mockResolvedValueOnce(false);
  state.permission.mockRejectedValueOnce(new HttpError(403, "Denied", "PERMISSION_DENIED"));
  expect(await adapter.record("Customer")).toMatchObject({
    fields: { panelId: "", panelName: "" },
    outputs: { configured: true, panelStatus: "forbidden", canConfigure: false },
  });
  for (const status of ["missing", "invalid"]) {
    state.getPanel.mockResolvedValueOnce({ status });
    expect((await adapter.record("Customer")).outputs).toMatchObject({ configured: true, panelStatus: "unavailable" });
  }
});

it("offers a nullable panel reference and saves or clears through the binding owner", async () => {
  const form = panelFormDescriptionSchema.parse(await adapter.form("Customer", { panelId: null }));
  expect(form).toMatchObject({
    fields: [{ path: "/panelId", required: false, readOnly: false, control: { kind: "reference", objectType: PRODUCT_PANEL } }],
    values: { panelId: null },
    save: { operation: SAVE_OBJECT_DETAIL_PANEL },
  });
  state.permission.mockRejectedValueOnce(new HttpError(403, "Denied"));
  expect((await adapter.form("Customer")).fields[0].readOnly).toBe(true);

  expect(await save.execute(host, target, { values: { panelId: "panel-2" } })).toMatchObject({
    affected: { objects: [{ objectType: OBJECT_TYPE, primaryKey: "Customer" }] },
  });
  expect(setObjectDetail).toHaveBeenCalledWith(owner, credentials, "Customer", "panel-2");
  await save.execute(host, target, { values: { panelId: null } });
  expect(clearObjectDetail).toHaveBeenCalledWith(owner, credentials, "Customer");
  await clear.execute(host, target);
  expect(clearObjectDetail).toHaveBeenCalledTimes(2);
  state.getMapping.mockResolvedValueOnce(null);
  expect(await clear.unavailable(host, target)).toHaveProperty("reason");
  state.permission.mockRejectedValueOnce(new HttpError(403, "Denied"));
  expect(await clear.unavailable(host, target)).toHaveProperty("reason");
});
