import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n, setLocale, type TranslationMessages } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { SkillMeta } from "../../../core/skills/types";
import { SkillCategory, SkillType } from "../../../core/skills/constants";

const previousApp = process.env.APP_DEFAULT_LOCALE;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "p3-t3-en-"));

/**
 * Probe pack for a non-English request locale: every key resolves to a marker,
 * so if fixed app text is ever read with the request locale instead of the
 * app-text locale, the assertions below hit the marker instead of passing
 * through the en fallback. Keeps this test independent of any shipped
 * non-English locale pack.
 */
const zhCnProbeMessages = new Proxy(
  {},
  { get: (_target, key) => `[zh-CN] ${String(key)}` }
) as TranslationMessages;
const zhCnProbeMeta = {
  languageName: "[zh-CN] language name",
  outputInstruction: "[zh-CN] output instruction",
  conclusionPrefix: "[zh-CN] conclusion prefix",
};

function skill(): SkillMeta {
  return {
    isPublic: false,
    id: "demo",
    path: path.join(root, "demo"),
    manifest: {
      name: "demo",
      description: "looks up sales",
      category: SkillCategory.ANALYSIS,
      type: SkillType.EXECUTABLE,
      entries: ["main", "alt"],
      entry: "main",
      tags: [],
      version: "1.0.0",
    },
  } as SkillMeta;
}

afterAll(() => {
  if (previousApp === undefined) delete process.env.APP_DEFAULT_LOCALE;
  else process.env.APP_DEFAULT_LOCALE = previousApp;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("analysis app-language and input boundaries", () => {
  it("keeps app-language selection independent of request locale and rejects invalid tool inputs", async () => {
    process.env.APP_DEFAULT_LOCALE = "zh-CN";
    installContentLayout({
      runtimeRoot: root,
      prompts: [],
      publicSkillsRoot: path.join(os.tmpdir(), "no-public-skills"),
      runtimeResources: [],
    });
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: true,
      appTextLocale: "en",
      packs: {
        en: { messages: { ...en, ...appTextEn, "analysis.loop.skills.357": "REJECT_SKILL_ID" }, ...enLocaleMeta },
        "zh-CN": {
          messages: zhCnProbeMessages,
          ...zhCnProbeMeta,
        },
      },
    });
    setLocale("zh-CN");

    const skills = await import("../loop/skills");
    const chartMod = await import("../loop/chart");
    const report = await import("../report/report-assembly");
    const artifacts = await import("../task/artifacts");
    const plan = await import("../dimension/plan");

    const loadSkill = skills
      .createLoopSkillTools({
        trajectory: artifacts.createDeepAnalysisArtifactStore({ executionMode: "loop" }),
        domainId: "domain-1",
        selectedSkillIds: [],
        resolveEvidence: () => undefined,
      })
      .find((tool) => tool.name === "load_skill");
    const parameters = loadSkill?.parameters as { properties: { skill_id: { description: string } } };
    const appDescription = loadSkill!.description;
    const appParameterDescription = parameters.properties.skill_id.description;
    const appPrompt = skills.buildLoopSkillCapabilityPrompt([skill()]);
    expect(appDescription).not.toContain("[zh-CN]");
    expect(appPrompt).not.toContain("[zh-CN]");
    setLocale("en");
    const english = skills.createLoopSkillTools({
      trajectory: artifacts.createDeepAnalysisArtifactStore({ executionMode: "loop" }),
      domainId: "domain-1", selectedSkillIds: [], resolveEvidence: () => undefined,
    }).find(tool => tool.name === "load_skill")!;
    expect(appDescription).toBe(english.description);
    expect(appParameterDescription).toBe((english.parameters as typeof parameters).properties.skill_id.description);
    expect(appPrompt).toBe(skills.buildLoopSkillCapabilityPrompt([skill()]));
    setLocale("zh-CN");
    const failed = await loadSkill!.execute("call-1", {});
    expect(failed.content).toEqual([{ type: "text", text: "REJECT_SKILL_ID" }]);

    const chart = chartMod.assembleLoopChartCapability({
      domainId: "domain-1",
      userQuestion: "sales",
      visualizationSkillIds: ["viz"],
      reportDeliverableEnabled: true,
      resolveCandidates: () => [],
      trajectory: artifacts.createDeepAnalysisArtifactStore({ executionMode: "loop" }),
    });
    expect(chart.supervisorTools[0].name).toBe("generate_chart");
    expect(chart.supervisorTools[0].description).not.toContain("[zh-CN]");
    expect(chart.prompt).not.toContain("[zh-CN]");
    await expect(chart.supervisorTools[0].execute("call-2", {})).rejects.toThrow();

    expect(report.dimensionSectionTitle({ dimensionName: "Région", dimensionValue: "Est" })).toBe("Région: Est");
    expect(() =>
      plan.assertPlannedDimensionIds(
        [{ dimensionId: "", dimensionName: "Région", dimensionValue: "Est", subQuestions: [] }],
        "thread-1",
        1
      )
    ).toThrow();
  });
});
