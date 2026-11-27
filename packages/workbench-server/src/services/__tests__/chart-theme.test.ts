import { beforeEach, expect, it } from "vitest";
import {
  exportAssistantReportChartTheme,
  exportChartTheme,
  installAssistantReportChartTheme,
  installChartTheme,
} from "../chart-theme";

const main = { color: ["main-system-green"] };
const dataAgent = { color: ["#5B3FFF"], visualMap: { inRange: { color: ["#E8F5FF", "#4328D9"] } } };

beforeEach(() => {
  installChartTheme(main);
  installAssistantReportChartTheme();
});

it("scopes a product report palette to report charts and keeps the workbench palette intact", () => {
  expect(exportAssistantReportChartTheme()).toBe(main);
  installAssistantReportChartTheme(dataAgent);
  expect(exportAssistantReportChartTheme()).toBe(dataAgent);
  expect(exportChartTheme()).toBe(main);
});
