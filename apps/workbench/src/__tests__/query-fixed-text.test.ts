import { expect, it } from "vitest";
import { getLocale, setLocale } from "@ontomato/workbench-server/i18n/index";
import { configureOssI18n } from "../i18n";

it("keeps the OSS application locale fixed when a caller requests another language", () => {
  configureOssI18n();
  setLocale("zh-CN");
  expect(getLocale()).toBe("en");
});
