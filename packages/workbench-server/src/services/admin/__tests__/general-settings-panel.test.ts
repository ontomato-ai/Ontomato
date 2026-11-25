import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" }, apiBase: "/api" } }));
vi.mock("../../../identity/installed", () => ({ assertPermission: vi.fn(async () => undefined) }));

import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: true,
  appTextLocale: "en",
  packs: {
    en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta },
  },
});

const { createGeneralSettingsReads } = await import("../general-settings-panel");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("general settings panel owner reads", () => {
  it("emits stepper controls with min=1 and step 1 / 10 for numeric settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          knowledgeMaxResult: 10,
          dslCookerTimeout: 300000,
          lang: "en",
          languages: ["en", "zh-CN"],
          fields: {
            knowledgeMaxResult: { label: "Knowledge Max Results", help: "Max entries recalled" },
            dslCookerTimeoutSeconds: { label: "DSL Timeout (s)", help: "Timeout in seconds" },
            lang: { label: "Backend Language", help: "Data engine language" },
          },
        }),
      ),
    );

    const reads = createGeneralSettingsReads({
      owner: { userId: "u-1", domainId: "d-1" },
      credentials: { token: "t", locale: "en" } as never,
    });
    const form = await reads.form("general", { values: {} });

    expect(form.values).toEqual({
      knowledgeMaxResult: 10,
      dslCookerTimeoutSeconds: 300,
      lang: "en",
    });
    expect(form.fields.find((field) => field.path === "/knowledgeMaxResult")?.control).toEqual({
      kind: "number",
      min: 1,
      step: 1,
      presentation: "stepper",
    });
    expect(form.fields.find((field) => field.path === "/dslCookerTimeoutSeconds")?.control).toEqual({
      kind: "number",
      min: 1,
      step: 10,
      presentation: "stepper",
    });
    expect(form.fields.find((field) => field.path === "/lang")?.control).toMatchObject({
      kind: "select",
    });
  });
});
