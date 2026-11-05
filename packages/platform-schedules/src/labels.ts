import { computed } from "vue";
import { useI18n } from "vue-i18n";

/** Fills `{name}` placeholders; a plural key is `one | many` and picks its side by the `n` parameter. */
export type Translate = (key: string, named?: Record<string, unknown>, count?: number) => string;

/**
 * One task's display text: times in the reader's language and zone, and the states the contracts name. The list and the
 * run history share it so a status never reads two ways on one screen.
 *
 * A component reads its text under the package's own tree: the host merges `./locales/en` into its dictionary, so the
 * keys a component resolves are `platformSchedules.<key>`, exactly like the `t` the page hands the list.
 */
export function useSchedulesLabels() {
  const { t, locale } = useI18n();
  const translate: Translate = (key, named, count) =>
    count === undefined
      ? t(`platformSchedules.${key}`, named ?? {})
      : t(`platformSchedules.${key}`, named ?? {}, count);

  return {
    t: translate,
    locale: computed(() => locale.value),
    time: (iso: string) =>
      new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),
    status: (status: "running" | "completed" | "failed") => translate(`runStatus.${status}`),
    /** Status colours follow DESIGN "Status": always with an icon or this label, never colour alone. */
    statusType: (status: "running" | "completed" | "failed") =>
      status === "failed" ? ("danger" as const) : status === "completed" ? ("success" as const) : ("primary" as const),
    trigger: (trigger: "manual" | "schedule" | "unknown") => translate(`trigger.${trigger}`),
    error: (error: { code: string; message: string | null }) =>
      [translate(`errorCode.${error.code}`), error.message].filter(Boolean).join(" "),
    /** The application a task belongs to; an id this build does not know stays as it came, never as "undefined". */
    app: (appId: string) =>
      appId === "agents" || appId === "ontology" ? translate(`app.${appId}`) : appId,
    /** On, off, or why the system paused a task its owner left on. */
    taskState: (task: { enabled: boolean; pausedReason: string | null }) =>
      task.pausedReason ? translate(`paused.${task.pausedReason}`) : task.enabled ? translate("state.on") : translate("state.off"),
    taskStateType: (task: { enabled: boolean; pausedReason: string | null }) =>
      task.pausedReason ? ("warning" as const) : task.enabled ? ("success" as const) : ("info" as const),
  };
}
