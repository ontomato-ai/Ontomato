import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createI18n } from "vue-i18n";
import type { PlatformTask, PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import en from "../locales/en";

/** The page's own dictionary, so tests read the same text a user does. */
export function testI18n(locale = "en") {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages: { en: en as unknown as { platformSchedules: Record<string, unknown> } },
  });
}

/** The list's `t`, resolved against the package's dictionary exactly as the page resolves it. */
export function translate(i18n: ReturnType<typeof testI18n>) {
  const { t } = i18n.global;
  return (key: string, named?: Record<string, unknown>, count?: number) =>
    count === undefined ? t(`platformSchedules.${key}`, named ?? {}) : t(`platformSchedules.${key}`, named ?? {}, count);
}

/** Mount options for a component that renders Element Plus widgets and reads the page's text. */
export function pageGlobal(i18n = testI18n()) {
  return { plugins: [i18n, ElementPlus] };
}

/** A component's rendered text, whitespace flattened so a row can be asserted in one string. */
export function text(component: { text: () => string }) {
  return component.text().replace(/\s+/g, " ").trim();
}

export { flushPromises, mount };

/** One task as the service sends it: an agent task with a prompt, on a daily schedule. */
export function task(overrides: Partial<PlatformTask> = {}): PlatformTask {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    appId: "agents",
    ownerId: "user-1",
    name: "Nightly summary",
    description: null,
    target: { kind: "agent", agentId: "22222222-2222-4222-8222-222222222222", prompt: "Summarise yesterday's orders" },
    frequency: { kind: "daily", time: "09:00" },
    timeZone: "Asia/Shanghai",
    notifyEmail: null,
    enabled: true,
    pausedReason: null,
    nextRunAt: "2026-11-06T01:00:00Z",
    createdAt: "2026-11-05T01:00:00Z",
    updatedAt: "2026-11-05T01:00:00Z",
    lastRun: null,
    ...overrides,
  };
}

/** One run as the service sends it. */
export function run(overrides: Partial<PlatformTaskRun> = {}): PlatformTaskRun {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    taskId: "11111111-1111-4111-8111-111111111111",
    target: { kind: "agent", agentId: "22222222-2222-4222-8222-222222222222", prompt: "Summarise" },
    sessionId: "44444444-4444-4444-8444-444444444444",
    trigger: "schedule",
    status: "completed",
    error: null,
    result: null,
    spendTime: 1200,
    startedAt: "2026-11-05T01:00:00Z",
    finishedAt: "2026-11-05T01:00:02Z",
    ...overrides,
  };
}
