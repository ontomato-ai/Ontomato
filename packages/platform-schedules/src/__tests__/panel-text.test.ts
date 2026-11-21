import { expect, it } from "vitest";
import { scheduledTaskFrequencyText, scheduledTaskPanelMessages, scheduledTaskPanelTextEn } from "../panel-text";

it("renders single and plural interval labels for the task list", () => {
  const messages = scheduledTaskPanelMessages(scheduledTaskPanelTextEn);
  const translate = (key: string, values?: Record<string, string | number>) =>
    messages[key]!.replace("{n}", String(values?.n));
  expect(scheduledTaskFrequencyText({ kind: "interval", every: 1, unit: "hour" }, "en", translate)).toBe("Every hour");
  expect(scheduledTaskFrequencyText({ kind: "interval", every: 2, unit: "hour" }, "en", translate)).toBe("Every 2 hours");
});
