/** The owner supplies the same field labels to the direct panel and to the frame. */
export function scheduledTaskFieldLabels(translate: (key: string) => string) {
  return {
    application: translate("platformSchedules.form.app"),
    settings: translate("platformSchedules.panelFields.settings"),
    state: translate("platformSchedules.panelFields.state"),
    nextRun: translate("platformSchedules.panelFields.nextRun"),
    lastRun: translate("platformSchedules.panelFields.lastRun"),
  };
}

export interface ScheduledTaskPanelText {
  form: { app: string };
  action: { runNow: string };
  panelFields: { settings: string; state: string; nextRun: string; lastRun: string };
  panelRunStarted: string;
  runStatus: { running: string; completed: string; failed: string; skipped: string };
}

/** Exposes the same owner messages in the Node locale pack's flat format. */
export function scheduledTaskPanelMessages(text: ScheduledTaskPanelText): Record<string, string> {
  return {
    "platformSchedules.form.app": text.form.app,
    "platformSchedules.action.runNow": text.action.runNow,
    "platformSchedules.panelRunStarted": text.panelRunStarted,
    ...Object.fromEntries(Object.entries(text.panelFields).map(([key, value]) => [`platformSchedules.panelFields.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.runStatus).map(([key, value]) => [`platformSchedules.runStatus.${key}`, value])),
  };
}

export const scheduledTaskPanelTextEn = {
  form: { app: "Application" },
  action: { runNow: "Run now" },
  panelFields: { settings: "Settings", state: "Status", nextRun: "Next run", lastRun: "Last run" },
  panelRunStarted: "The run has started.",
  runStatus: {
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
  },
} satisfies ScheduledTaskPanelText;

export const scheduledTaskPanelTextZhCn = {
  form: { app: "应用" },
  action: { runNow: "立即运行" },
  panelFields: { settings: "配置", state: "状态", nextRun: "下次运行", lastRun: "上次运行" },
  panelRunStarted: "已开始运行。",
  runStatus: {
    running: "运行中",
    completed: "完成",
    failed: "失败",
    skipped: "已跳过",
  },
} satisfies ScheduledTaskPanelText;
