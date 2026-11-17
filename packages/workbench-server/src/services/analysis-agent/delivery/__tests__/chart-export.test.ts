import { describe, expect, it } from "vitest";
import { legacyChartToFile, type ChartFile } from "@ontomato/contracts/chart-data";
import { chartValueText } from "@ontomato/contracts/chart-presentation";
import { chartMapNames, exportChartOption } from "../chart-export";
import { renderChartOptionToDataUrl } from "../chart-renderer";

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

describe("export chart options", () => {
  it("fills the file from its snapshot and applies the user's value formatting", () => {
    const built = exportChartOption(pieFile(), { theme, height: 500, width: 1000, locale: "de-DE" });
    if (!built.ok) throw new Error(built.reason);
    expect(built.option.dataset[0].source).toEqual([{ name: "A", value: 0.25 }]);
    expect(built.option.ontomato).toBeUndefined();
    const label = built.option.series[0].label.formatter({ name: "A", value: 0.25 });
    expect(label).toContain("25,0%");
  });

  it("keeps the browser's default formatting when no locale is given", () => {
    expect(chartValueText(1234.5, { kind: "number", decimals: 1 })).toBe((1234.5).toLocaleString(undefined, {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }));
    expect(chartValueText(1234.5, { kind: "number", decimals: 1 }, "de-DE")).toBe("1.234,5");
  });

  it("returns the boundary reason instead of drawing an incomplete snapshot", () => {
    const file = pieFile();
    file.dataset[0].source = [{ name: "A" }];
    const built = exportChartOption(file, { theme, height: 500 });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain("value");
  });

  it("names the map resources an option draws", () => {
    expect(chartMapNames({ geo: { map: "china-provinces" }, series: [{ map: "china-provinces" }, { type: "bar" }] }))
      .toEqual(["china-provinces"]);
  });

  it("writes a gauge centre in the export locale", async () => {
    const converted = legacyChartToFile({
      type: "gauge", fields: { value: "value" },
      display: { formats: { value: { kind: "percent", scale: 1, decimals: 1 } } },
    });
    if (!converted.ok) throw new Error(converted.code);
    converted.file.dataset[0].source = [{ value: 25 }];
    const built = exportChartOption(converted.file, { theme, height: 500, width: 1000, locale: "de-DE" });
    if (!built.ok) throw new Error(built.reason);
    expect(built.option.series[0].detail.formatter()).toBe("25,0%");
    const svg = Buffer.from((await renderChartOptionToDataUrl(built.option, theme)).split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("25,0%");
  });

  it("registers the platform boundaries when rendering a map", async () => {
    const converted = legacyChartToFile({
      type: "admin-choropleth-map", fields: { name: "province", value: "sales" },
      map: { resource: "china-provinces", coordinateSystem: "WGS-84", regionsMatched: true },
    });
    if (!converted.ok) throw new Error(converted.code);
    converted.file.dataset[0].source = [{ province: "北京", sales: 12 }, { province: "广东", sales: 26 }];
    const built = exportChartOption(converted.file, { theme, height: 500, width: 1000 });
    if (!built.ok) throw new Error(built.reason);
    const svg = Buffer.from((await renderChartOptionToDataUrl(built.option, theme)).split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("<path");
  });
});
