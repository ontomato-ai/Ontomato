import { afterEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { requirePanelEntry, requirePanelUseEntry } from "../application-use";
import { registeredPanelRootId } from "../member-path";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

const credentials = { token: "initiator" };
const ref = { applicationId: "application", useId: "use" };

afterEach(() => { vi.unstubAllGlobals(); });

it("explains how to correct an unregistered application and use pair", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ error: { code: "NOT_FOUND", message: "Panel entry not found" } }, { status: 404 })));
  const message = expect.stringMatching(/No registered panel entrance matches the supplied applicationId and useId.*Available entrances/u);
  await expect(requirePanelEntry(credentials, ref)).rejects.toMatchObject({ status: 404, message });
  await expect(requirePanelUseEntry(credentials, ref)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message });
});

it("identifies a denied entrance as an access refusal for the initiating user", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ error: { code: "FORBIDDEN", message: "Application access denied" } }, { status: 403 })));
  const message = expect.stringMatching(/initiating user does not have access to this panel entrance/u);
  await expect(requirePanelUseEntry(credentials, ref)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message });
});

it("resolves a native entry without treating its frame as a registered panel root", async () => {
  const use = { id: ref.useId, pageKey: "landing", kind: "native", path: "/application" };
  const data = {
    applicationId: ref.applicationId, use, framePanelId: "builtin-product-platform-frame",
    menu: { singleEntry: true, groups: [], panelUses: [] },
  };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data })));

  const resolved = await requirePanelEntry(credentials, ref);
  expect(resolved.use).toEqual(use);
  expect(registeredPanelRootId({ ...ref, kind: "frame" }, resolved)).toBeUndefined();
  await expect(requirePanelUseEntry(credentials, ref)).rejects.toMatchObject({ status: 404, code: "PANEL_ENTRY_UNAVAILABLE" });
});
