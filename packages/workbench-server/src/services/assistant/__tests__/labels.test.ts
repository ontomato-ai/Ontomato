import { expect, it, vi } from "vitest";
import { assistantDescription } from "../labels";

vi.mock("../../../i18n", () => ({ tForLocale: (locale: string, key: string) => `${locale}:${key}` }));

it("localizes existing shipped descriptions with the requested locale", () => {
  expect(assistantDescription({ kind: "analysis", description: "Investigate questions and produce reports" }, "zh-CN"))
    .toBe("zh-CN:assistant.default.analysis.description");
  expect(assistantDescription({ kind: "regular", description: "Ask questions about your data" }, "ja"))
    .toBe("ja:assistant.default.regular.description");
});

it("preserves customized and user-created agent descriptions", () => {
  expect(assistantDescription({ kind: "analysis", description: "Custom analyst" }, "zh-CN")).toBe("Custom analyst");
  expect(assistantDescription({ kind: "custom", description: "Investigate questions and produce reports" }, "zh-CN"))
    .toBe("Investigate questions and produce reports");
});
