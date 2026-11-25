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
  title: string;
  loadFailed: string;
  form: Record<"app" | "appUnknown" | "serviceZone" | "taskZone" | "content" | "noFields" | "after" | "notifyPlaceholder" | "formChanged", string>;
  action: { runNow: string };
  card: { viewResult: string; viewEarlierResult: string; noResult: string };
  notice: { applicationsFailed: string; applicationsMissing: string; noApplication: string };
  duration: { took: string; seconds: string; minutes: string; hours: string };
  panelFields: {
    settings: string; state: string; nextRun: string; lastRun: string; lastRunAt: string; lastRunSummary: string;
    latestResultPath: string; resultStateLabel: string; allApplications: string; pauseReason: string;
    stateOn: string; stateOff: string; statePaused: string;
  };
  runFields: {
    status: string; trigger: string; startedAt: string; scheduledAt: string; duration: string;
    error: string; resultSummary: string; snapshotSummary: string; result: string; executionDetails: string;
    resultPath: string;
  };
  trigger: { manual: string; schedule: string; unknown: string };
  runError: Record<
    | "credential_invalid"
    | "creator_unavailable"
    | "permission_denied"
    | "target_unavailable"
    | "definition_changed"
    | "application_unavailable"
    | "dependency_unavailable"
    | "start_failed"
    | "run_failed"
    | "cancelled"
    | "interrupted"
    | "autotest_busy"
    | "prior_run_active"
    | "legacy_failure",
    string
  >;
  frequency: { every: Record<"minute" | "hour" | "day", string>; daily: string; weekly: string; monthly: string; cron: string };
  panelErrors: { revisionConflict: string; invalidDraftField: string; invalidDraftParameter: string };
  panelSettings: { title: string; frequency: string; timeZone: string; notifyEmail: string };
  panelManagement: {
    save: string; create: string; setEnabled: string; enabled: string; disabled: string;
    delete: string; deleteImpact: string; deleted: string; renewCredential: string;
  };
  panelRunStarted: string;
  runStatus: { running: string; completed: string; failed: string; skipped: string };
  attention: { issues: string; results: string; running: string };
}

/** Exposes the same owner messages in the Node locale pack's flat format. */
export function scheduledTaskPanelMessages(text: ScheduledTaskPanelText): Record<string, string> {
  return {
    "platformSchedules.title": text.title,
    "platformSchedules.loadFailed": text.loadFailed,
    ...Object.fromEntries(Object.entries(text.form).map(([key, value]) => [`platformSchedules.form.${key}`, value])),
    "platformSchedules.action.runNow": text.action.runNow,
    ...Object.fromEntries(Object.entries(text.card).map(([key, value]) => [`platformSchedules.card.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.notice).map(([key, value]) => [`platformSchedules.notice.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.duration).map(([key, value]) => [`platformSchedules.duration.${key}`, value])),
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
    ...Object.fromEntries(Object.entries(text.runFields).map(([key, value]) => [`platformSchedules.runFields.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.trigger).map(([key, value]) => [`platformSchedules.trigger.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.runError).map(([key, value]) => [`platformSchedules.runError.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.runStatus).map(([key, value]) => [`platformSchedules.runStatus.${key}`, value])),
    ...Object.fromEntries(Object.entries(text.attention).map(([key, value]) => [`platformSchedules.attention.${key}`, value])),
  };
}

export const scheduledTaskPanelTextEn = {
  title: "Scheduled tasks",
  loadFailed: "Couldn't load the scheduled tasks.",
  form: {
    app: "Application",
    appUnknown: "Not installed",
    serviceZone: "In the service's time zone ({zone}).",
    taskZone: "In this task's time zone ({zone}).",
    content: "What {app} gets",
    noFields: "This application needs nothing more.",
    after: "After it runs",
    notifyPlaceholder: "Optional. One message after each run, success or failure.",
    formChanged: "The application's form changed since you opened it and has been replaced; check the fields and save again.",
  },
  action: { runNow: "Run now" },
  card: {
    viewResult: "View result",
    viewEarlierResult: "View earlier result",
    noResult: "No result yet",
  },
  notice: {
    applicationsFailed: "The applications that can run on a schedule could not be read, so new tasks are unavailable for now.",
    applicationsMissing:
      "This page has no name for the application {ids} the service declares, so new tasks are switched off. Ask an administrator to check the installation.",
    noApplication: "No application can run on a schedule for you right now.",
  },
  duration: {
    took: "Took {time}",
    seconds: "{n} s",
    minutes: "{m} min {s} s",
    hours: "{h} h {m} min",
  },
  panelFields: {
    settings: "Settings", state: "Status", nextRun: "Next run", lastRun: "Last run",
    lastRunAt: "Last run time", lastRunSummary: "Last run summary", latestResultPath: "Latest result",
    resultStateLabel: "Result",
    allApplications: "All", pauseReason: "Pause reason",
    stateOn: "On", stateOff: "Switched off", statePaused: "Paused",
  },
  runFields: {
    status: "Status",
    trigger: "Trigger",
    startedAt: "Started",
    scheduledAt: "Planned for",
    duration: "Duration",
    error: "Error",
    resultSummary: "Summary",
    snapshotSummary: "Settings when it ran",
    result: "Result",
    executionDetails: "Execution details",
    resultPath: "Result link",
  },
  trigger: {
    manual: "Manual",
    schedule: "Scheduled",
    unknown: "Unknown trigger",
  },
  runError: {
    credential_invalid: "The background credential no longer works",
    creator_unavailable: "The creator is disabled or no longer in this domain",
    permission_denied: "The creator lacks a permission it needs",
    target_unavailable: "What it runs is no longer available",
    definition_changed: "What it runs has changed and needs checking",
    application_unavailable: "The application is not installed",
    dependency_unavailable: "A service it depends on was unavailable",
    start_failed: "It could not start",
    run_failed: "It ended with an error",
    cancelled: "It was cancelled",
    interrupted: "It was interrupted; check what it did before running it again",
    autotest_busy: "The previous test batch was still running",
    prior_run_active: "The previous run of this task was still going",
    legacy_failure: "It failed before the upgrade",
  },
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
    save: "Save task", create: "Create task", setEnabled: "Change task status",
    enabled: "The task was switched on.", disabled: "The task was switched off.",
    delete: "Delete task",
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
  attention: {
    issues: "Needs attention",
    results: "Recent results",
    running: "Running",
  },
} satisfies ScheduledTaskPanelText;

export const scheduledTaskPanelTextZhCn = {
  title: "定时任务",
  loadFailed: "定时任务列表加载失败。",
  form: {
    app: "应用",
    appUnknown: "未安装",
    serviceZone: "按服务时区（{zone}）。",
    taskZone: "按这个任务的时区（{zone}）。",
    content: "交给{app}的内容",
    noFields: "这个应用不需要再填别的。",
    after: "跑完以后",
    notifyPlaceholder: "选填。跑完发一封信，成功、失败都发",
    formChanged: "打开期间应用表单已变更，请重新加载表单核对后再保存。",
  },
  action: { runNow: "立即运行" },
  card: {
    viewResult: "查看结果",
    viewEarlierResult: "查看上一次结果",
    noResult: "没有结果",
  },
  notice: {
    applicationsFailed: "未能读取可定时的应用列表，暂时无法新建任务。",
    applicationsMissing: "页面缺少服务声明的应用 {ids} 名称，已暂停新建任务，请联系管理员检查安装配置。",
    noApplication: "当前没有可为您定时运行的应用。",
  },
  duration: {
    took: "耗时 {time}",
    seconds: "{n} 秒",
    minutes: "{m} 分 {s} 秒",
    hours: "{h} 小时 {m} 分",
  },
  panelFields: {
    settings: "配置", state: "状态", nextRun: "下次运行", lastRun: "上次运行",
    lastRunAt: "上次运行时间", lastRunSummary: "上次运行摘要", latestResultPath: "最近结果",
    resultStateLabel: "执行结果",
    allApplications: "全部", pauseReason: "暂停原因",
    stateOn: "已启用", stateOff: "已停用", statePaused: "已暂停",
  },
  runFields: {
    status: "状态",
    trigger: "触发方式",
    startedAt: "开始时间",
    scheduledAt: "计划时间",
    duration: "耗时",
    error: "失败原因",
    resultSummary: "结果摘要",
    snapshotSummary: "运行时的配置",
    result: "结果",
    executionDetails: "执行详情",
    resultPath: "结果链接",
  },
  trigger: {
    manual: "手动",
    schedule: "定时",
    unknown: "未知触发",
  },
  runError: {
    credential_invalid: "后台凭证已失效",
    creator_unavailable: "创建人已停用或不在当前域",
    permission_denied: "创建人已失去所需权限",
    target_unavailable: "要运行的内容已不可用",
    definition_changed: "要运行的内容已变更，需要重新核对",
    application_unavailable: "所属应用未安装",
    dependency_unavailable: "依赖的服务当时不可用",
    start_failed: "未能启动",
    run_failed: "执行出错",
    cancelled: "已取消",
    interrupted: "执行中断，请确认已发生的结果后再决定是否重跑",
    autotest_busy: "上一批自动测试仍在运行",
    prior_run_active: "这个任务上一次还没跑完",
    legacy_failure: "升级前的失败记录",
  },
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
    save: "保存任务", create: "新建任务", setEnabled: "更改任务状态",
    enabled: "已启用任务。", disabled: "已停用任务。",
    delete: "删除任务",
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
  attention: {
    issues: "需处理",
    results: "最近完成",
    running: "运行中",
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
