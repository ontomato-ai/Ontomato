import type { PlatformTaskFrequency } from "@ontomato/contracts/platform-schedules";
import { weekdayName } from "./frequency";

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
  panelFields: { settings: string; state: string; nextRun: string; lastRun: string; lastRunAt: string; lastRunSummary: string; latestResultPath: string };
  frequency: { every: Record<"minute" | "hour" | "day", string>; daily: string; weekly: string; monthly: string; cron: string };
  panelErrors: { revisionConflict: string; invalidDraftField: string; invalidDraftParameter: string };
  panelSettings: { title: string; frequency: string; timeZone: string; notifyEmail: string };
  panelManagement: { save: string; create: string; setEnabled: string; delete: string; deleteImpact: string; deleted: string; renewCredential: string };
  panelRunStarted: string;
  runStatus: { running: string; completed: string; failed: string; skipped: string };
}

/** Exposes the same owner messages in the Node locale pack's flat format. */
export function scheduledTaskPanelMessages(text: ScheduledTaskPanelText): Record<string, string> {
  return {
    "platformSchedules.form.app": text.form.app,
    "platformSchedules.action.runNow": text.action.runNow,
    "platformSchedules.panelRunStarted": text.panelRunStarted,
    "platformSchedules.panelErrors.revisionConflict": text.panelErrors.revisionConflict,
    "platformSchedules.panelErrors.invalidDraftField": text.panelErrors.invalidDraftField,
    "platformSchedules.panelErrors.invalidDraftParameter": text.panelErrors.invalidDraftParameter,
    ...Object.fromEntries(Object.entries(text.frequency.every).map(([key, value]) => [`platformSchedules.frequency.every.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.frequency).filter(([key]) => key !== "every")
      .map(([key, value]) => [`platformSchedules.frequency.${key}`, String(value)])),
    ...Object.fromEntries(Object.entries(text.panelSettings).map(([key, value]) => [`platformSchedules.panelSettings.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.panelManagement).map(([key, value]) => [`platformSchedules.panelManagement.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.panelFields).map(([key, value]) => [`platformSchedules.panelFields.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.runStatus).map(([key, value]) => [`platformSchedules.runStatus.${key}`, value])),
  };
}

export const scheduledTaskPanelTextEn = {
  form: { app: "Application" },
  action: { runNow: "Run now" },
  panelFields: { settings: "Settings", state: "Status", nextRun: "Next run", lastRun: "Last run", lastRunAt: "Last run time", lastRunSummary: "Last run summary", latestResultPath: "Latest result" },
  frequency: {
    every: {
      minute: "Every minute | Every {n} minutes",
      hour: "Every hour | Every {n} hours",
      day: "Every day | Every {n} days",
    },
    daily: "Every day at {time}",
    weekly: "Every {weekday} at {time}",
    monthly: "Day {day} of every month at {time}",
    cron: "Cron {expression}",
  },
  panelErrors: {
    revisionConflict: "This task changed. Reload it before editing.",
    invalidDraftField: "The draft has an invalid value for {field}. Use the fields and values shown in the task form.",
    invalidDraftParameter: "The draft field {field} must be text. Fill in each application field separately.",
  },
  panelSettings: { title: "Title", frequency: "Frequency", timeZone: "Time zone", notifyEmail: "Notification email" },
  panelManagement: {
    save: "Save task", create: "Create task", setEnabled: "Change task status", delete: "Delete task",
    renewCredential: "Renew background credential",
    deleteImpact: "This deletes the task and its execution history.",
    deleted: "Task “{name}” deleted",
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
  panelFields: { settings: "配置", state: "状态", nextRun: "下次运行", lastRun: "上次运行", lastRunAt: "上次运行时间", lastRunSummary: "上次运行摘要", latestResultPath: "最近结果" },
  frequency: {
    every: {
      minute: "每分钟 | 每 {n} 分钟",
      hour: "每小时 | 每 {n} 小时",
      day: "每天 | 每 {n} 天",
    },
    daily: "每天 {time}",
    weekly: "每{weekday} {time}",
    monthly: "每月 {day} 日 {time}",
    cron: "Cron {expression}",
  },
  panelErrors: {
    revisionConflict: "任务已变更，请重新加载后再编辑。",
    invalidDraftField: "草稿中的 {field} 无效。请按任务表单显示的字段填写。",
    invalidDraftParameter: "草稿中的 {field} 必须是文本。请分别填写应用表单中的各个字段。",
  },
  panelSettings: { title: "标题", frequency: "频率", timeZone: "时区", notifyEmail: "通知邮箱" },
  panelManagement: {
    save: "保存任务", create: "新建任务", setEnabled: "更改任务状态", delete: "删除任务",
    renewCredential: "续期后台凭证",
    deleteImpact: "将删除任务和它的执行记录。",
    deleted: "任务「{name}」已删除",
  },
  panelRunStarted: "已开始运行。",
  runStatus: {
    running: "运行中",
    completed: "完成",
    failed: "失败",
    skipped: "已跳过",
  },
} satisfies ScheduledTaskPanelText;

/** Formats the owner's frequency for a reader using the same wording as the scheduled-task form. */
export function scheduledTaskFrequencyText(
  value: PlatformTaskFrequency, locale: string, translate: (key: string, values?: Record<string, string | number>) => string,
): string {
  switch (value.kind) {
    case "interval": {
      const forms = translate(`platformSchedules.frequency.every.${value.unit}`, { n: value.every }).split("|");
      return (forms[value.every === 1 ? 0 : forms.length - 1] ?? forms[0]!).trim();
    }
    case "daily": return translate("platformSchedules.frequency.daily", { time: value.time });
    case "weekly": return translate("platformSchedules.frequency.weekly", { weekday: weekdayName(value.weekday, locale), time: value.time });
    case "monthly": return translate("platformSchedules.frequency.monthly", { day: value.day, time: value.time });
    case "cron": return translate("platformSchedules.frequency.cron", { expression: value.expression });
  }
}
