import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { TurnRun } from "../../../services/turn-run/turn-run-store";

const state = vi.hoisted(() => ({
  turn: undefined as TurnRun | undefined,
  qualityCheckStarted: () => {},
  qualityCheck: Promise.resolve(),
}));

vi.mock("../../../services/chat/graph/workflow", () => ({
  runDataAgentWorkflow: async () => {
    vi.setSystemTime(new Date(10_000));
    return {
      pendingLateFacts: {
        settleAll: () => {
          state.qualityCheckStarted();
          return state.qualityCheck;
        },
      },
    };
  },
}));
vi.mock("../../../infrastructure/connection", () => ({
  initializeConnection: async () => {},
  getCheckpointer: () => undefined,
}));
vi.mock("../../../services/chat/thread-store", () => ({
  startStandardTurn: async ({ threadId }: { threadId: string }) => {
    state.turn = {
      threadId, requestSeq: 0, status: "running",
      startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    return 0;
  },
}));
vi.mock("../../../services/turn-run/turn-run-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../services/turn-run/turn-run-store")>(),
  recordTurnAnswerCompletion: async ({ completedAt }: { completedAt: Date }) => {
    state.turn!.answerCompletedAt = completedAt;
  },
  recordTurnRunFinish: async ({ status }: { status: string }) => {
    state.turn!.status = status;
    state.turn!.endedAt ??= new Date();
    return state.turn;
  },
}));
vi.mock("../../utils/title", () => ({ generateTitleAsync: async () => undefined }));
vi.mock("../../../i18n", () => ({
  setLocale: () => {}, t: (key: string) => key, tApp: (key: string) => key,
}));

import router from "../chat";
import { turnRunDurationMs } from "../../../services/turn-run/turn-run-store";
import { runStreamStore } from "../../utils/run-stream";

let server: http.Server | undefined;
let finishQualityCheck: () => void;

afterEach(async () => {
  finishQualityCheck();
  vi.useRealTimers();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

it("keeps answer timing unchanged while quality checks keep the run open", async () => {
  installWorkbenchIdentity({
    requireDomainId: (identity: { domainId?: string | null }) => identity.domainId!,
  } as unknown as WorkbenchIdentity);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(0));
  const qualityCheckStarted = new Promise<void>((resolve) => { state.qualityCheckStarted = resolve; });
  state.qualityCheck = new Promise<void>((resolve) => { finishQualityCheck = resolve; });

  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "user", domainId: "domain" });
    next();
  });
  app.use("/chat", router);
  server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const response = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/chat?message=count&threadId=timing-thread&runId=timing-run`);
  const responseBody = response.then((result) => result.text());
  await Promise.race([qualityCheckStarted, responseBody.then((body) => { throw new Error(`Stream ended before quality-check settlement: ${body}`); })]);
  expect(runStreamStore.getActiveRunByKey("chat:timing-thread")?.status).toBe("running");

  vi.setSystemTime(new Date(70_000));
  finishQualityCheck();
  const body = await responseBody;
  const events = body.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));

  expect(events.find((event) => event.type === "turn_finished")?.durationMs).toBe(10_000);
  expect(body).toContain("data: [DONE]");
  expect(state.turn?.endedAt).toEqual(new Date(70_000));
  // History derives its duration from the same persisted turn fact, not the stream's closing time.
  expect(turnRunDurationMs(state.turn)).toBe(10_000);
});
