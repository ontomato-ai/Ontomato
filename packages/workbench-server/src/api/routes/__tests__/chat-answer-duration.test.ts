import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { TurnRun } from "../../../services/turn-run/turn-run-store";

const state = vi.hoisted(() => ({
  turn: undefined as TurnRun | undefined,
}));

vi.mock("../../../services/chat/graph/workflow", () => ({
  runDataAgentWorkflow: async ({ onEvent }: { onEvent: (event: object) => void }) => {
    vi.setSystemTime(new Date(10_000));
    onEvent({
      type: "post_thinking",
      content: "",
      qcState: { status: "running", steps: [], deadlineAt: 120_000 },
    });
    return {};
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

afterEach(async () => {
  vi.useRealTimers();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

it("finishes the answer and accepts a follow-up while quality remains pending", async () => {
  installWorkbenchIdentity({
    requireDomainId: (identity: { domainId?: string | null }) => identity.domainId!,
  } as unknown as WorkbenchIdentity);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(0));

  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "user", domainId: "domain" });
    next();
  });
  app.use("/chat", router);
  server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat?threadId=timing-thread`;
  const body = await (await fetch(`${url}&message=count&runId=timing-run`)).text();
  const events = body.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));

  expect(events.find((event) => event.type === "turn_finished")?.durationMs).toBe(10_000);
  expect(events.find((event) => event.type === "post_thinking")?.qcState.status).toBe("running");
  expect(body).toContain("data: [DONE]");
  expect(runStreamStore.getActiveRunByKey("chat:timing-thread")).toBeUndefined();
  expect(state.turn?.endedAt).toEqual(new Date(10_000));
  expect(turnRunDurationMs(state.turn)).toBe(10_000);

  const followUp = await fetch(`${url}&message=compare&runId=follow-up`);
  expect(followUp.status).toBe(200);
  expect(await followUp.text()).toContain("data: [DONE]");
});
