/*
 * Panel Q's declaration: the summary projection and nothing of P. Its `selectedTask` is whatever address it was opened at
 * named, so it shows one task without listing or choosing any, and it keeps that choice to itself.
 */
export default {
  state: {
    selectedTask: { type: { kind: "object", objectType: "platform:ScheduledTask" }, deepLink: true },
  },
  members: {
    summary: { target: { projectionId: "projection-schedules-summary" }, inputs: { task: { state: "selectedTask" } } },
  },
  commands: {},
};
