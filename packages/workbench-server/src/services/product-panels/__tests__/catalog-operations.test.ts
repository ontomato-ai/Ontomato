import { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";

const applicationRecord = vi.hoisted(() => vi.fn());
vi.mock("../application-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("../application-catalogue")>();
  return {
    ...actual,
    applicationCatalogueClient: (viewer: never) => ({
      ...actual.applicationCatalogueClient(viewer),
      record: applicationRecord,
    }),
  };
});

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

beforeEach(() => {
  applicationRecord.mockReset();
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
  const placement = { projection, member, slot: "form", panel: { manifest: { members: { form: member }, state: {} } } };

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

it.each([
  ["forbidden", new HttpError(403, "Forbidden", "FORBIDDEN")],
  ["not found", new HttpError(404, "Not found", "NOT_FOUND")],
  ["network error", new Error("ECONNREFUSED")],
])("marks applications.delete unavailable when reading the application fails (%s) without breaking sibling operations", async (_kind, error) => {
  applicationRecord.mockRejectedValue(error);
  const { readAdmittedProjectionOperations } = await import("../direct-operations");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "app-actions", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    name: "Application actions", description: "", visibility: "private", componentId: "@ontomato/sdk:ObjectHeader",
    inputs: { app: { kind: "object", objectType: APPLICATION } }, outputs: {}, config: {},
    data: {},
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "app" } },
      share: { operation: { kind: "PlatformOperation", id: "applications.share" }, target: { input: "app" } },
    },
  });
  const member = { target: { projectionId: projection.id }, inputs: { app: { state: "selected" } } };
  const placement = {
    projection,
    member,
    slot: "header",
    panel: {
      manifest: {
        members: { header: member },
        state: {
          selected: {
            type: { kind: "object" as const, objectType: APPLICATION },
            personal: false,
            deepLink: false,
            external: false,
          },
        },
      },
    },
  };

  const admitted = await readAdmittedProjectionOperations(
    { owner, credentials: { locale: "en" } },
    placement,
    { app: { className: APPLICATION, primaryKey: "app-1" } },
  );
  expect(admitted.delete?.unavailable).toEqual({ reason: en["panels.productCatalog.application.availabilityUnavailable"] });
  expect(admitted.share).toBeDefined();
  expect(admitted.share?.unavailable).toBeUndefined();
});

it("marks applications.delete unavailable for read-only applications and available when maintainable", async () => {
  const { readAdmittedProjectionOperations } = await import("../direct-operations");
  const owner = { domainId: "domain", userId: "reader" };
  const projection = productProjectionSchema.parse({
    id: "app-delete", domainId: owner.domainId, ownerId: owner.userId, editable: true,
    revision: 1, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    name: "Delete application", description: "", visibility: "private", componentId: "@ontomato/sdk:OperationButton",
    inputs: { app: { kind: "object", objectType: APPLICATION } }, outputs: {}, config: { operation: "delete" },
    data: {},
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "app" } },
    },
  });
  const member = { target: { projectionId: projection.id }, inputs: { app: { state: "selected" } } };
  const placement = {
    projection,
    member,
    slot: "deleteApp",
    panel: {
      manifest: {
        members: { deleteApp: member },
        state: {
          selected: {
            type: { kind: "object" as const, objectType: APPLICATION },
            personal: false,
            deepLink: false,
            external: false,
          },
        },
      },
    },
  };
  const readOps = () => readAdmittedProjectionOperations(
    { owner, credentials: { locale: "en" } },
    placement,
    { app: { className: APPLICATION, primaryKey: "app-1" } },
  );

  applicationRecord.mockResolvedValueOnce({ id: "app-1", canMaintain: false });
  expect((await readOps()).delete?.unavailable).toEqual({ reason: en["panels.productCatalog.application.readOnly"] });

  applicationRecord.mockResolvedValueOnce({ id: "app-1", canMaintain: true });
  expect((await readOps()).delete?.unavailable).toBeUndefined();
});
