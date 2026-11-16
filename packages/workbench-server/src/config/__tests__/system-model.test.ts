import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../content/layout";
import { runWithLogContext } from "../../logging/log-context";
import {
  DEFAULT_ABC_QUESTION_MODE,
  DEFAULT_QUERY_TIMEOUT_SECONDS,
  DEFAULT_NODE_MODEL_STREAMING_ENABLED,
  SystemModelConfigError,
  getSystemModelConfig,
  saveSystemModelConfig,
} from "../system-model";

describe("system-model configuration", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "system-model-test-"));
    installContentLayout({
      runtimeRoot: tmpDir,
      prompts: [],
      publicSkillsRoot: path.join(os.tmpdir(), "no-public-skills"),
      runtimeResources: [],
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default values when configuration file does not exist", () => {
    const config = getSystemModelConfig("domain-new");
    expect(config).toEqual({
      abcQuestionMode: DEFAULT_ABC_QUESTION_MODE,
      queryTimeoutSeconds: DEFAULT_QUERY_TIMEOUT_SECONDS,
      nodeModelStreamingEnabled: DEFAULT_NODE_MODEL_STREAMING_ENABLED,
    });
  });

  it("saves and reads the domain runtime settings", () => {
    const saved = saveSystemModelConfig("domain-1", {
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
      nodeModelStreamingEnabled: true,
    });
    expect(saved).toEqual({
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
      nodeModelStreamingEnabled: true,
    });

    const loaded = getSystemModelConfig("domain-1");
    expect(loaded).toEqual({
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
      nodeModelStreamingEnabled: true,
    });
  });

  it("reads domainId from LogContext when domainId argument is omitted", () => {
    runWithLogContext({ domainId: "domain-ctx" }, () => {
      saveSystemModelConfig(undefined as any, { queryTimeoutSeconds: 120 });
      const loaded = getSystemModelConfig();
      expect(loaded.queryTimeoutSeconds).toBe(120);
    });
  });

  it("throws SystemModelConfigError when domainId is missing both in arg and LogContext", () => {
    expect(() => getSystemModelConfig()).toThrow(SystemModelConfigError);
    expect(() => saveSystemModelConfig("", {})).toThrow(SystemModelConfigError);
  });

  it("rejects legacy shape in saveSystemModelConfig with models or agents", () => {
    expect(() =>
      saveSystemModelConfig("domain-legacy-save", {
        models: [{ baseUrl: "http://example.com" }],
      } as any)
    ).toThrow(SystemModelConfigError);

    expect(() =>
      saveSystemModelConfig("domain-legacy-save", {
        agents: { query: { model: "m1" } },
      } as any)
    ).toThrow(SystemModelConfigError);
  });

  it("migrates a legacy config file with models or agents on read, keeping only the surviving fields", () => {
    const domainId = "domain-legacy-file";
    const encoded = encodeURIComponent(domainId).replace(/\./g, "%2E");
    const filePath = path.join(tmpDir, "data", "system-model-config", `${encoded}.json`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Write file with legacy models field and an invalid legacy abcQuestionMode.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        models: [{ id: "m1", modelName: "legacy" }],
        abcQuestionMode: "fast",
        queryTimeoutSeconds: 300,
      }),
      "utf-8"
    );

    const config = getSystemModelConfig(domainId);
    expect(config).toEqual({
      abcQuestionMode: DEFAULT_ABC_QUESTION_MODE,
      queryTimeoutSeconds: 300,
      nodeModelStreamingEnabled: true,
    });

    // The file is rewritten in the current shape, with models/agents dropped.
    const rewritten = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(rewritten).toEqual({
      abcQuestionMode: DEFAULT_ABC_QUESTION_MODE,
      queryTimeoutSeconds: 300,
      nodeModelStreamingEnabled: true,
    });
  });

  it("saves the independent switch without changing other fields or another domain", () => {
    saveSystemModelConfig("switch-a", { abcQuestionMode: "tool_fixed", queryTimeoutSeconds: 180 });
    saveSystemModelConfig("switch-a", { nodeModelStreamingEnabled: false });
    expect(getSystemModelConfig("switch-a")).toEqual({
      abcQuestionMode: "tool_fixed", queryTimeoutSeconds: 180, nodeModelStreamingEnabled: false,
    });
    saveSystemModelConfig("switch-a", { queryTimeoutSeconds: 240 });
    expect(getSystemModelConfig("switch-a").nodeModelStreamingEnabled).toBe(false);
    expect(getSystemModelConfig("switch-b").nodeModelStreamingEnabled).toBe(true);
    expect(() => saveSystemModelConfig("switch-a", {
      nodeModelStreamingEnabled: "false" as unknown as boolean,
    })).toThrow(SystemModelConfigError);
  });

  it("defaults an absent switch without rewriting an existing current-format file", () => {
    const file = path.join(tmpDir, "data", "system-model-config", "old-current.json");
    const source = JSON.stringify({ abcQuestionMode: "harness", queryTimeoutSeconds: 100 });
    fs.writeFileSync(file, source);
    expect(getSystemModelConfig("old-current").nodeModelStreamingEnabled).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(source);
  });

  it("reports a malformed stored document and refuses to overwrite it with defaults", () => {
    const file = path.join(tmpDir, "data", "system-model-config", "broken.json");
    fs.writeFileSync(file, "{broken");
    expect(() => getSystemModelConfig("broken")).toThrow(SystemModelConfigError);
    expect(() => saveSystemModelConfig("broken", { nodeModelStreamingEnabled: false }))
      .toThrow(SystemModelConfigError);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });

  it("validates invalid queryTimeoutSeconds and abcQuestionMode", () => {
    expect(() =>
      saveSystemModelConfig("domain-invalid", {
        queryTimeoutSeconds: -1,
      })
    ).toThrow(SystemModelConfigError);

    expect(() =>
      saveSystemModelConfig("domain-invalid", {
        abcQuestionMode: "invalid-mode" as any,
      })
    ).toThrow(SystemModelConfigError);
  });
});
