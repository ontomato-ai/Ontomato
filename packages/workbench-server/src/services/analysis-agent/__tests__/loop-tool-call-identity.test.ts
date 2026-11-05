import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";

/**
 * Loop activities carry the supervisor tool call that produced them, so the page can place that
 * call's public record under its step. Worker calls belong to the worker trace and carry none.
 * Doubles: the skill registry (no skill resolves) and the logger.
 */
vi.mock("../../../logging/logger", () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock("../../../core/skills", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  skillRegistryManager: {
    forDomain: async () => ({
      getSkills: () => [
        { manifest: { name: "s1", description: "skill", type: "knowledge", entries: [] } },
      ],
      resolveSkill: () => {
        throw new Error("no such skill");
      },
    }),
  },
}));
configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-call-identity-"));
installContentLayout({
  runtimeRoot: root,
  prompts: [],
  runtimeResources: [],
  publicSkillsRoot: path.join(root, "public"),
});
const { createDeepAnalysisArtifactStore } = await import("../task/artifacts");
const { assembleLoopNotebookCapability } = await import("../loop/notebook");
const { assembleLoopChartCapability } = await import("../loop/chart");
const { assembleLoopSkillCapability } = await import("../loop/skills");

const notebooks: Array<{ dispose(): void }> = [];
afterAll(() => {
  for (const notebook of notebooks) notebook.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

function trajectory() {
  const events: DeepAnalysisEmittedEvent[] = [];
  const store = createDeepAnalysisArtifactStore({
    executionMode: "loop",
    emit: (event) => events.push(event),
  });
  const emitted = (activityId: string) =>
    events
      .filter((event) => event.type === "analysis_activity")
      .map((event) => event.content as AnalysisActivity)
      .filter((activity) => activity.activityId === activityId);
  return { store, emitted };
}

it("records the supervisor call identity on chapter, chart and skill activities, through every published revision", async () => {
  const { store, emitted } = trajectory();
  const notebook = assembleLoopNotebookCapability({
    reportDeliverableEnabled: true,
    dirKey: `identity-${Date.now()}`,
    trajectory: store,
  });
  notebooks.push(notebook.notebook!);
  const tool = (name: string) => notebook.supervisorTools.find((item) => item.name === name)!;
  await tool("write_chapter").execute("call-write", { chapter: "01.md", content: "body" });
  await tool("publish_chapter").execute("call-publish", { chapter: "01.md" });

  const chart = assembleLoopChartCapability({
    domainId: "domain",
    userQuestion: "sales",
    visualizationSkillIds: ["chart"],
    reportDeliverableEnabled: true,
    resolveCandidates: () => [],
    trajectory: store,
  });
  await chart.supervisorTools[0].execute("call-chart", { questionIds: ["q-1"] });

  const skills = await assembleLoopSkillCapability({
    trajectory: store,
    domainId: "domain",
    selectedSkillIds: ["s1"],
    resolveEvidence: () => undefined,
  });
  await skills.supervisorTools.find((item) => item.name === "load_skill")!.execute("call-skill", {
    skill_id: "s1",
  });

  const activities = store.current().activities;
  expect(activities.map((activity) => [activity.kind, activity.toolCallId])).toEqual([
    ["chapter", "call-write"],
    ["publish", "call-publish"],
    ["chart", "call-chart"],
    ["skill", "call-skill"],
  ]);
  // Settling republishes the whole activity: the live event stream never loses the identity.
  for (const activity of activities) {
    const revisions = emitted(activity.activityId);
    expect(revisions.length).toBeGreaterThan(1);
    expect(revisions.every((revision) => revision.toolCallId === activity.toolCallId)).toBe(true);
  }
  // Recovery from a stored payload keeps it as recorded.
  const restored = createDeepAnalysisArtifactStore({
    executionMode: "loop",
    initialPayload: JSON.parse(JSON.stringify(store.current())),
  });
  expect(restored.current().activities.map((activity) => activity.toolCallId)).toEqual([
    "call-write",
    "call-publish",
    "call-chart",
    "call-skill",
  ]);
});

it("leaves worker-side activities without a call identity", async () => {
  const { store } = trajectory();
  const notebook = assembleLoopNotebookCapability({
    reportDeliverableEnabled: true,
    dirKey: `identity-worker-${Date.now()}`,
    trajectory: store,
  });
  notebooks.push(notebook.notebook!);
  await notebook
    .createWorkerTools("dispatch-1")
    .find((item) => item.name === "write_chapter")!
    .execute("worker-call-write", { chapter: "02.md", content: "body" });
  const skills = await assembleLoopSkillCapability({
    trajectory: store,
    domainId: "domain",
    selectedSkillIds: ["s1"],
    resolveEvidence: () => undefined,
  });
  await skills.workerTools.find((item) => item.name === "load_skill")!.execute("worker-call-skill", {
    skill_id: "s1",
  });

  const [chapter, skill] = store.current().activities;
  expect(chapter).toMatchObject({ kind: "chapter", dispatchId: "dispatch-1" });
  expect(chapter.toolCallId).toBeUndefined();
  expect(skill.kind).toBe("skill");
  expect(skill.toolCallId).toBeUndefined();
});
