import { expect, it } from "vitest";
import { workbenchI18n } from "..";

it("resolves general form choice labels in the public locale", () => {
  const { te, t } = workbenchI18n().global;
  for (const key of [
    "platform.formSearchOptions",
    "platform.formCreateOption",
    "platform.formSelectFiltered",
    "platform.formClearFiltered",
    "platform.formOptionNoLonger",
    "platform.formMatrixRowNoLonger",
    "platform.formRemoveChoice",
    "platform.formMatrixSetAll",
  ]) {
    expect(te(key), key).toBe(true);
  }
  for (const key of ["platform.formRemoveChoice", "platform.formMatrixSetAll"]) {
    expect(t(key, { label: "Reports" }), key).toContain("Reports");
  }
});
