export const triggerFixture = {
  id: "tr-1", title: "Daily Order Check", description: null,
  targetKind: "workflow", targetId: "wf-1", targetName: "Order Approval", appId: null,
  content: { inputs: {} }, formRevision: null, summary: [],
  creatorId: "user-1", executorId: "user-1", coauthorIds: [], reviewedBy: null,
  status: "PUBLISHED", version: 1, revision: 2, enabled: true, pause: null,
  frequency: { kind: "daily", time: "09:00" }, timeZone: "UTC", notifyEmail: null,
  createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T01:00:00Z",
  nextRunAt: "2026-11-26T09:00:00Z", lastFiredAt: null,
  activeRunId: null, lastRun: null, latestResult: null,
} as const;
