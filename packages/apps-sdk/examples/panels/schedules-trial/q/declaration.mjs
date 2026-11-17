/*
 * Panel Q's declaration: the summary projection and nothing of P. Its `selectedTask` is whatever address it was opened at
 * named, so it shows one task without listing or choosing any, and it keeps that choice to itself.
 */
export default {
  state: {
    selectedTask: { kind: "object", objectType: "platform:ScheduledTask", deepLink: true },
  },
  slots: {
    summary: { projectionId: "projection-schedules-summary", inputs: { task: { state: "selectedTask" } } },
  },
  operations: [],
};
