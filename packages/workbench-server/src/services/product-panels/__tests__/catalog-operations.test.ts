import { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeAll, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      fr: { ...enLocaleMeta, messages: { "panels.productCatalog.save": "Enregistrer" } },
    },
  });
});

it.each([PRODUCT_PROJECTION, PRODUCT_PANEL, APPLICATION])("describes %s save in the reader's language", async type => {
  const { readAdmittedProjectionOperations } = await import("../direct-operations");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "editor", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    name: "Catalogue editor", description: "", visibility: "private", componentId: "@ontomato/sdk:ObjectForm",
    inputs: {}, outputs: {}, config: {},
    data: { createForm: { source: { type: { kind: "PlatformObjectType", id: type } }, read: "createForm", params: {} } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${type}.save` } } },
  });
  const member = { target: { projectionId: projection.id } };
  const placement = { projection, member, slot: "form", panel: { manifest: { members: { form: member }, state: {}, events: {} } } };

  const describe = (locale: string) => readAdmittedProjectionOperations({ owner, credentials: { locale } }, placement, {});
  expect(await describe("en")).toMatchObject({ save: { label: "Save" } });
  expect(await describe("fr")).toMatchObject({ save: { label: "Enregistrer" } });
});
