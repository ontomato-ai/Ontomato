import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installContentLayout } from "../../../content/layout";
import { afterAll, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-input-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.join(root, "public") });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const { assembleLoopChartCapability } = await import("../loop/chart");
const { assertPlannedDimensionIds } = await import("../dimension/plan");
const { createDeepAnalysisArtifactStore } = await import("../task/artifacts");

it("rejects a chart request without any evidence identities", async () => {
  const chart = assembleLoopChartCapability({ domainId: "domain", userQuestion: "sales", visualizationSkillIds: ["chart"],
    reportDeliverableEnabled: false, resolveCandidates: () => [], trajectory: createDeepAnalysisArtifactStore({ executionMode: "loop" }),
  });
  await expect(chart.supervisorTools[0].execute("call", { questionIds: [] })).rejects.toThrow();
});
it("rejects a dimension identity made only of whitespace", () => {
  expect(() => assertPlannedDimensionIds([{ dimensionId: "  ", dimensionName: "Region", dimensionValue: "East", subQuestions: [] }], "thread", 1)).toThrow();
});
