import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n, setLocale } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { renderPrompt } from "../../../core/prompts/loader";
import { assembleLoopNotebookCapability } from "../loop/notebook";
import { createDeepAnalysisArtifactStore } from "../task/artifacts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-prompt-test-"));
const promptsDir = path.resolve(__dirname, "../../../../prompts");

installContentLayout({
  runtimeRoot: root,
  prompts: [{ from: promptsDir, to: "." }],
  publicSkillsRoot: path.join(root, "public"),
  runtimeResources: [],
});

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});
setLocale("en");

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The baseline system.md template before introducing {{evidenceRequirements}} and {{workingMethod}}
 */
const BASELINE_SYSTEM_MD_TEMPLATE = `You are the supervisor Agent for this task. You work in a response loop: each round you decide what to do next, until you judge the task complete.

## Dataset Definition
{{datasetSchema}}
{{loopPromptContext}}
{{currentUser}}
## Available Capabilities
- \`collect_evidence\`: hand one or more query questions to the data system to obtain this round's current data evidence. You may submit multiple questions at once; they execute concurrently. A question's failure only affects that question; you may retry with a different wording, or continue with the evidence you already have.
{{dataProbeCapability}}
{{chartCapability}}
{{skillCapability}}
{{externalMcpCapability}}
{{actionCapability}}
{{metricViewCapability}}
{{deliverableCapability}}
## Evidence Collection Requirements
- Query questions must be complete and directly answerable by the data system, specifying the object, metric, definition, and time range clearly.
- **Evidence discipline**: query execution is slow, and task latency is mainly determined by the number of serial evidence-collection rounds. Submit all the questions you can think of in one large concurrent batch in the first round, then at most one more supplementary round; do not go back and forth one by one, nor repeatedly squeeze out supplementary fetches bit by bit.
- What the tool returns is data as seen in display-value form: \`headRows\` and \`tailRows\` come from the head and tail of the data respectively, and \`isComplete=false\` means the middle rows are omitted; do not treat the two segments as adjacent data, nor infer full statistics from them.
- Only use the real evidence and tool results explicitly obtained in the current session, preserving their source and time; do not pass off historical data that has not been re-queried as the latest data. Numbers and conclusions without a basis cannot serve as the task result; evidence that cannot be obtained must be stated explicitly.

## Working Method
- First think about which independent topics this question contains and what evidence each topic needs, then decide which to dispatch to workers and which to do yourself.
- Dispatch all mutually independent topics in one round at once; they execute concurrently, and the total latency is roughly equal to the slowest one.
- Continue collecting evidence when it is insufficient; do not fill gaps with speculation.
{{completionInstruction}}`;

function renderSupervisorPrompt(reportDeliverableEnabled: boolean): string {
  const trajectory = createDeepAnalysisArtifactStore({ executionMode: "loop" });
  const notebookCapability = assembleLoopNotebookCapability({
    reportDeliverableEnabled,
    dirKey: `test-${Date.now()}`,
    trajectory,
  });
  try {
    return renderPrompt("analysis-agent.loop.system", {
      datasetSchema: "schema_content",
      loopPromptContext: "",
      dataProbeCapability: "",
      deliverableCapability: notebookCapability.supervisorPrompt,
      completionInstruction: notebookCapability.completionInstruction,
      evidenceRequirements: notebookCapability.evidenceRequirements,
      workingMethod: notebookCapability.workingMethod,
      chartCapability: "",
      skillCapability: "",
      externalMcpCapability: "",
      actionCapability: "",
      metricViewCapability: "",
      currentUser: "",
    });
  } finally {
    notebookCapability.notebook?.dispose();
  }
}

function renderBaselinePromptWithOldTemplate(reportDeliverableEnabled: boolean): string {
  const trajectory = createDeepAnalysisArtifactStore({ executionMode: "loop" });
  const notebookCapability = assembleLoopNotebookCapability({
    reportDeliverableEnabled,
    dirKey: `test-baseline-${Date.now()}`,
    trajectory,
  });
  try {
    let template = BASELINE_SYSTEM_MD_TEMPLATE;
    const variables: Record<string, string> = {
      datasetSchema: "schema_content",
      loopPromptContext: "",
      dataProbeCapability: "",
      deliverableCapability: notebookCapability.supervisorPrompt,
      completionInstruction: notebookCapability.completionInstruction,
      chartCapability: "",
      skillCapability: "",
      externalMcpCapability: "",
      actionCapability: "",
      metricViewCapability: "",
      currentUser: "",
    };
    for (const [name, value] of Object.entries(variables)) {
      template = template.replaceAll(`{{${name}}}`, value);
    }
    return template;
  } finally {
    notebookCapability.notebook?.dispose();
  }
}

describe("loop supervisor prompt assembly", () => {
  it("renders report mode supervisor prompt verbatim matching the baseline before time/instruction suffix", () => {
    const rendered = renderSupervisorPrompt(true);
    const baselineOldTemplate = renderBaselinePromptWithOldTemplate(true);

    // renderPrompt appends server time and language instruction; the body before that must match verbatim
    expect(rendered.startsWith(baselineOldTemplate)).toBe(true);
  });

  it("renders regular mode supervisor prompt with constrained dispatch, single-question evidence discipline, and direct working method", () => {
    const rendered = renderSupervisorPrompt(false);

    // dispatch_analyst constrained
    expect(rendered).toContain(
      "- `dispatch_analyst`: hand an independent topic to a worker Agent only when the user explicitly requests macro-level or extensive analysis; in other cases (including when search or evidence collection misses), do not dispatch workers — complete it yourself or honestly state that no results were found."
    );
    expect(rendered).not.toContain(
      "Multiple dispatches issued in the same round execute concurrently."
    );

    // Continuous conversation & final reply present
    expect(rendered).toContain("## Continuous Conversation");
    expect(rendered).toContain("## Final Reply");

    // Evidence discipline updated
    expect(rendered).toContain(
      "- **Evidence discipline**: ask only one question if it can clarify what is needed; submit multiple questions together in the same round only when truly mutually independent data are required; do not repeatedly squeeze out supplementary fetches bit by bit."
    );
    expect(rendered).not.toContain(
      "Submit all the questions you can think of in one large concurrent batch in the first round"
    );

    // Working method updated
    expect(rendered).toContain(
      "- Complete the task directly yourself whenever possible; do not dispatch workers unless the user explicitly requests macro-level or extensive analysis; if search or evidence collection misses, honestly explain that no results were found."
    );
    expect(rendered).toContain(
      "- Continue collecting evidence when it is insufficient; do not fill gaps with speculation."
    );
    expect(rendered).not.toContain(
      "First think about which independent topics this question contains"
    );
    expect(rendered).not.toContain(
      "Dispatch all mutually independent topics in one round at once"
    );

    // Completion instruction for regular mode
    expect(rendered).toContain(
      "- After completing the task, use the last assistant text to directly give the final reply, then end the response."
    );
  });
});
