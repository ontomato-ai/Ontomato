import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { BackendResponseError } from "../../../utils/backend-client";

beforeAll(() => configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
}));

const java = vi.hoisted(() => ({ form: vi.fn(), saveIdentity: vi.fn() }));
vi.mock("../application-catalogue", async importOriginal => ({
  ...(await importOriginal<typeof import("../application-catalogue")>()),
  applicationCatalogueClient: () => java,
}));

const { productCatalogServerOperations } = await import("../catalog-operations");
const save = productCatalogServerOperations.find(operation => operation.handlerRef === `${APPLICATION}.save`)!;
const target = { kind: "object" as const, objectType: APPLICATION, primaryKey: "app-one" };
const identity = { names: { en: "One" }, descriptions: {}, icon: "pages" };
const run = () => save.execute({ executor: { credentials: {} } } as never, target as never,
  { values: { icon: "folder" }, submittedFields: ["/icon"] }, "intent-one");

beforeEach(() => {
  vi.resetAllMocks();
  java.form.mockResolvedValue({ values: identity });
});

it("keeps the fields a Java owner's refusal names, at the paths the panel form addresses", async () => {
  const unavailable = (field: string) => ({ field, code: "target_unavailable", message: "Not offered here." });
  java.saveIdentity.mockRejectedValue(new BackendResponseError(409, JSON.stringify({
    message: "Entry 'one' default agent is disabled.", code: "PAGE_DEFAULT_AGENT_UNAVAILABLE",
    errors: [unavailable("/values/panelUses/1/defaultAgent"), unavailable("/values/icon")],
  })));
  expect(await run()).toEqual({
    kind: "refusal", code: "PAGE_DEFAULT_AGENT_UNAVAILABLE", message: "Entry 'one' default agent is disabled.",
    errors: [unavailable("/panelUses/1/defaultAgent"), unavailable("/icon")],
  });
});

it("keeps any other owner refusal as its code and message", async () => {
  java.saveIdentity.mockRejectedValue(new BackendResponseError(409,
    JSON.stringify({ message: "Someone else changed it", code: "APPLICATION_REVISION_CONFLICT" })));
  expect(await run()).toEqual({ kind: "refusal", code: "APPLICATION_REVISION_CONFLICT", message: "Someone else changed it" });
});

it.each([
  ["a body that is not JSON", "<html>Bad gateway</html>"],
  ["field errors it cannot read", JSON.stringify({ message: "Refused", code: "APPLICATION_ENTRY_INVALID", errors: [{ field: "icon" }] })],
])("says so when the owner's refusal is %s, rather than passing it for an ordinary one", async (_case, body) => {
  java.saveIdentity.mockRejectedValue(new BackendResponseError(409, body));
  expect(await run()).toMatchObject({ kind: "refusal", code: "OWNER_REFUSAL_UNREADABLE" });
});
