import { describe, expect, it } from "vitest";
import { legacyChartToFile, type ChartFile } from "@ontomato/contracts/chart-data";
import { reportChartOption } from "../../../../../report-skill/chart-option.mjs";

const theme = { color: ["#123456"], textStyle: { color: "#111111" } };

function pieFile(): ChartFile {
  const converted = legacyChartToFile({
    type: "pie",
    fields: { name: "name", value: "value" },
    display: { formats: { value: { kind: "percent", scale: 100, decimals: 1 } } },
  });
  if (!converted.ok) throw new Error(converted.code);
  converted.file.dataset[0].source = [{ name: "A", value: 0.25 }];
  return converted.file;
}

describe("report chart options", () => {
  it("uses the same filling and formatting rules as the conversation chart", () => {
    const built = reportChartOption(pieFile(), theme, "de-DE");
    if (!built.ok) throw new Error(built.reason);
    expect(built.option.dataset[0].source).toEqual([{ name: "A", value: 0.25 }]);
    expect(built.option.series[0].label.formatter({ name: "A", value: 0.25 })).toContain("25,0%");
  });

  it("returns the boundary reason for a file that cannot be filled", () => {
    const file = pieFile();
    file.dataset[0].source = [{ name: "A" }];
    const built = reportChartOption(file, theme);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain("value");
  });
});
