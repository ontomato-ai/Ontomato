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
  panelSettings: { title: string; frequency: string; timeZone: string; notifyEmail: string };
  panelManagement: { save: string; create: string; setEnabled: string; delete: string; deleteImpact: string };
  panelRunStarted: string;
  runStatus: { running: string; completed: string; failed: string; skipped: string };
}

/** Exposes the same owner messages in the Node locale pack's flat format. */
export function scheduledTaskPanelMessages(text: ScheduledTaskPanelText): Record<string, string> {
  return {
    "platformSchedules.form.app": text.form.app,
    "platformSchedules.action.runNow": text.action.runNow,
    "platformSchedules.panelRunStarted": text.panelRunStarted,
    ...Object.fromEntries(Object.entries(text.panelSettings).map(([key, value]) => [`platformSchedules.panelSettings.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.panelManagement).map(([key, value]) => [`platformSchedules.panelManagement.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.panelFields).map(([key, value]) => [`platformSchedules.panelFields.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.runStatus).map(([key, value]) => [`platformSchedules.runStatus.${key}`, value])),
  };
}

export const scheduledTaskPanelTextEn = {
  form: { app: "Application" },
  action: { runNow: "Run now" },
  panelFields: { settings: "Settings", state: "Status", nextRun: "Next run", lastRun: "Last run" },
  panelSettings: { title: "Title", frequency: "Frequency", timeZone: "Time zone", notifyEmail: "Notification email" },
  panelManagement: {
    save: "Save task", create: "Create task", setEnabled: "Change task status", delete: "Delete task",
    deleteImpact: "This deletes the task and its execution history.",
  },
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
  panelSettings: { title: "标题", frequency: "频率", timeZone: "时区", notifyEmail: "通知邮箱" },
  panelManagement: {
    save: "保存任务", create: "新建任务", setEnabled: "更改任务状态", delete: "删除任务",
    deleteImpact: "将删除任务和它的执行记录。",
  },
  panelRunStarted: "已开始运行。",
  runStatus: {
    running: "运行中",
    completed: "完成",
    failed: "失败",
    skipped: "已跳过",
  },
} satisfies ScheduledTaskPanelText;
