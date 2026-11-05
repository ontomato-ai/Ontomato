import { expect, it } from "vitest";
import { installWorkbenchContent } from "@ontomato/workbench-ui/content";
import { EchartsGenerator } from "@ontomato/workbench-ui/features/dashboard/components/utils/echartsGenerator";
import { workbenchContent } from "../../../web/src/workbench-content";

installWorkbenchContent(workbenchContent);

it.each([
  ["radar", "RADAR_INVALID", { category: "name", value: "amount" }],
  ["area-line", "AREALINE_INVALID", { xAxis: "name", yAxis: "amount" }],
])("distinguishes missing input from renderable %s data", (type, code, fields) => {
  const generator = new EchartsGenerator();
  expect(generator.generateWithHealth(type, "t", {}, []).health).toMatchObject({ ok: false, code });
  const rows = [{ name: "A", amount: 1 }, { name: "B", amount: 2 }, { name: "C", amount: 3 }];
  expect(generator.generateWithHealth(type, "t", fields, rows).health).toMatchObject({ ok: true, code: "OK" });
});
