/*
 * Panel P's declaration: the state it keeps and the projections it composes, as plain data. It is one file so the panel
 * and the script that registers it read the same declaration — the panel wraps it in `definePanel`, the script validates
 * it and puts it into the panel's record.
 *
 * `selectedTask` is the panel's own: the same panel open twice keeps two readers' choices apart. The summary, the form
 * and the button take it as their input, which is how one selection reaches those three and nothing else.
 */
export default {
  state: {
    selectedTask: { kind: "object", objectType: "platform:ScheduledTask", deepLink: true },
  },
  slots: {
    tasks: { projectionId: "projection-schedules-tasks", inputs: { value: { state: "selectedTask" } } },
    summary: { projectionId: "projection-schedules-summary", inputs: { task: { state: "selectedTask" } } },
    form: { projectionId: "projection-schedules-form", inputs: { task: { state: "selectedTask" } } },
    run: { projectionId: "projection-schedules-run", inputs: { task: { state: "selectedTask" } } },
  },
  // The panel offers no operation of its own: every button it shows is a projection's.
  operations: [],
};
