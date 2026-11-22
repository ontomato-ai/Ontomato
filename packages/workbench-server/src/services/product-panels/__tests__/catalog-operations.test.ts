import { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeAll, expect, it } from "vitest";
import { fieldPatterns } from "../catalog-operations";
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
  const placement = { projection, member, slot: "form", panel: { manifest: { members: { form: member }, state: {}, commands: {} } } };

  const describe = (locale: string) => readAdmittedProjectionOperations({ owner, credentials: { locale } }, placement, {});
  expect(await describe("en")).toMatchObject({ save: { label: "Save" } });
  expect(await describe("fr")).toMatchObject({ save: { label: "Enregistrer" } });
});

it("includes object-variant fields and nested array-row variant fields in fieldPatterns", () => {
  const text = (path: string, label: string): PanelFormField => ({
    path, label, valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" },
  });
  const option = (value: string, label: string) => ({
    value, label, description: null, disabled: false, disabledReason: null,
  });
  const fields: PanelFormField[] = [{
    path: "/steps",
    label: "Steps",
    valueSchema: { type: "array" },
    required: false,
    readOnly: false,
    control: {
      kind: "object-array",
      itemFields: [{
        path: "/executor",
        label: "Executor",
        valueSchema: { type: "object" },
        required: false,
        readOnly: false,
        control: {
          kind: "object",
          fields: [{
            path: "/mode",
            label: "Mode",
            valueSchema: { type: "string" },
            required: true,
            readOnly: false,
            control: { kind: "select", options: [option("none", "None"), option("rule", "Rule"), option("agent", "Agent")] },
          }],
          variantBy: "/mode",
          variants: {
            rule: [text("/ruleId", "Rule")],
            agent: [text("/agentId", "Agent"), text("/prompt/template", "Prompt")],
          },
        },
      }],
    },
  }];

  expect(fieldPatterns(fields)).toEqual([
    ["steps"],
    ["steps", "*", "executor"],
    ["steps", "*", "executor", "mode"],
    ["steps", "*", "executor", "ruleId"],
    ["steps", "*", "executor", "agentId"],
    ["steps", "*", "executor", "prompt", "template"],
  ]);
});
