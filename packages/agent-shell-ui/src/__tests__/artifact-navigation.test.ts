import { expect, it } from "vitest";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { OpenArtifact } from "../types";
import { testDisplay } from "./display";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function file(path: string): OpenArtifact {
  return {
    title: path,
    key: `${runId}:${path}`,
    artifact: { runId, path } as RuntimeArtifact,
  };
}

const report = file("outputs/reports/example/report.md");
const data = file("outputs/source.dataset.json");
const notes = file("outputs/notes.md");
const createDisplay = () => testDisplay({ id: "test", label: "Test", features: [] });

it("returns to the report when a linked file is closed", async () => {
  const display = createDisplay();
  await display.openArtifact(report);
  await display.openArtifact(data, report.key);
  expect(display.artifacts.value).toEqual([report, data]);

  await display.closeArtifact(data.key);
  expect(display.target.value).toEqual({ kind: "artifact", open: report });
  expect(display.artifacts.value).toEqual([report]);

  await display.closeArtifact(report.key);
  expect(display.target.value).toBeNull();
});

it("clears file ancestry when opening a standalone file or leaving the conversation", async () => {
  const display = createDisplay();
  await display.openArtifact(report);
  await display.openArtifact(data, report.key);
  await display.openArtifact(notes);
  expect(await display.openArtifact(data, report.key)).toBe(false);
  expect(display.artifacts.value).toEqual([notes]);

  await display.openArtifact(data, notes.key);
  await display.close();
  expect(display.artifacts.value).toEqual([]);
});

it("returns to an existing ancestor when files link back to it", async () => {
  const display = createDisplay();
  await display.openArtifact(report);
  await display.openArtifact(data, report.key);
  await display.openArtifact(notes, data.key);
  await display.openArtifact(report, notes.key);
  expect(display.artifacts.value).toEqual([report]);
});
