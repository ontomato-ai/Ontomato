import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { loadSkills } from "../observe/agent/skill-loader";
import { createBashTool } from "../observe/agent/tools/builtin/bash-tool";
import { createEditTool } from "../observe/agent/tools/builtin/edit-tool";
import { createReadTool } from "../observe/agent/tools/builtin/read-tool";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "p3-t2-import-"));

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeBadSkill(dir: string) {
  const skillDir = path.join(dir, "demo");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), '---\nname: demo\ndescription: " "\n---\nbody\n');
}

describe("diagnosis text before configure", () => {
  it("imports without evaluating tool or skill text", () => {
    const empty = path.join(root, "empty-skills");
    const bad = path.join(root, "bad-skills");
    fs.mkdirSync(empty);
    writeBadSkill(bad);
    expect(loadSkills(empty)).toEqual([]);
    expect(() => loadSkills(bad)).toThrow("Workbench i18n is not configured");
    expect(() => createBashTool()).toThrow("Workbench i18n is not configured");
    expect(() => createReadTool()).toThrow("Workbench i18n is not configured");
    expect(() => createEditTool()).toThrow("Workbench i18n is not configured");
  });

  it("reads only the requested lines, edits the file and excludes invalid skills after assembly", async () => {
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: false,
      appTextLocale: "en",
      packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
    });

    const dir = path.join(root, "after-config");
    const bad = path.join(dir, "bad-skills");
    const sample = path.join(dir, "sample.txt");
    const missing = path.join(dir, "missing.txt");
    const editable = path.join(dir, "note.txt");
    fs.mkdirSync(dir);
    writeBadSkill(bad);
    fs.writeFileSync(sample, "first-line\nsecond-line\nthird-line");
    fs.writeFileSync(editable, "alpha\nbeta\ngamma\n");
    const limited = await createReadTool().execute("call-1", { path: sample, limit: 1 });
    const absent = await createReadTool().execute("call-2", { path: missing });
    expect(limited.content[0].text).toContain("first-line");
    expect(limited.content[0].text).not.toContain("second-line");
    expect(limited.content[0].text).not.toContain("third-line");
    const next = await createReadTool().execute("next", { path: sample, offset: 2, limit: 1 });
    expect(next.content[0].text).toContain("second-line");
    expect(next.content[0].text).not.toContain("first-line");
    expect(next.content[0].text).not.toContain("third-line");
    expect(absent.content[0].text).toContain(missing);

    await createEditTool().execute("call-3", {
      path: editable,
      old_string: "beta",
      new_string: "BETA",
    });
    expect(fs.readFileSync(editable)).toEqual(Buffer.from("alpha\nBETA\ngamma\n"));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSkills(bad)).toEqual([]);
    warn.mockRestore();
  });
});
