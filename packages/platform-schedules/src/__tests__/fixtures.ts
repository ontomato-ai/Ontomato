import { vi } from "vitest";
import { defineComponent, h, markRaw } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createI18n } from "vue-i18n";
import {
  platformScheduleApplicationsSchema,
  platformScheduleErrorSchema,
  platformScheduleFormSchema,
  platformTaskRunSchema,
  platformTaskSchema,
  type PlatformScheduleResultLink,
  type PlatformTask,
  type PlatformTaskRun,
} from "@ontomato/contracts/platform-schedules";
import rawExamples from "../../../contracts/examples/platform-schedules.json";
import type { PlatformSchedulesHost, PlatformSchedulesHostApp } from "../host";
import en from "../locales/en";

/*
 * Every answer a test hands the page is one of the contract's own round-trip examples, parsed by the contract's schema
 * again after any change a test makes, so the page is tested against what the service is held to send.
 */
type Example = { name: string; status?: number; request?: unknown; response: unknown };
const examples = rawExamples as unknown as {
  applicationsEnglish: { response: unknown };
  forms: Example[];
  creates: Example[];
  runs: Example[];
  errors: Example[];
};
const named = (list: Example[], name: string) => {
  const found = list.find((example) => example.name === name);
  if (!found) throw new Error(`No contract example ${name}`);
  return found;
};

export const applications = () => platformScheduleApplicationsSchema.parse(examples.applicationsEnglish.response);
export const form = (name: string) => platformScheduleFormSchema.parse(named(examples.forms, name).response);
export const formRequest = (name: string) => named(examples.forms, name).request;
/** A task the service returned, changed as a test needs and checked against the contract again. */
export const task = (name: string, change: Partial<PlatformTask> = {}): PlatformTask =>
  platformTaskSchema.parse({ ...(named(examples.creates, name).response as object), ...change });
export const run = (name: string, change: Partial<PlatformTaskRun> = {}): PlatformTaskRun =>
  platformTaskRunSchema.parse({ ...(named(examples.runs, name).response as object), ...change });
/** A run as a card carries it (`lastRun`): the record without its snapshot, result and execution details. */
export function summaryOf(record: PlatformTaskRun) {
  const { snapshot: _snapshot, result: _result, executionDetails: _details, ...summary } = record;
  return summary;
}
/** A refusal exactly as the contract's examples spell it: its HTTP status and its error body. */
export const refusal = (name: string) => {
  const example = named(examples.errors, name);
  return { status: example.status!, body: platformScheduleErrorSchema.parse(example.response) };
};

/** Icons are components: kept raw, as the rail's own are, when a test's props make everything around them reactive. */
const icon = (name: string) => markRaw(defineComponent({ name, render: () => h("i", { class: `icon-${name}` }) }));
/** The rail's applications in its order, as the platform declares them. */
export const HOST_APPS: PlatformSchedulesHostApp[] = [
  { id: "ontology", label: "Ontology Manager", icon: icon("ontology") },
  { id: "browser", label: "Object browser", icon: icon("objects") },
  { id: "agents", label: "Agent Platform", icon: icon("agents") },
  { id: "operations", label: "Operations diagnosis", icon: icon("diagnosis") },
  { id: "governance", label: "Knowledge governance", icon: icon("knowledge") },
  { id: "schedules", label: "Scheduled tasks", icon: icon("schedule") },
];

export const BASE = "/api/data-query/platform/scheduled-tasks";

/** What one request is answered with: a status and a body, or a thrown error (no answer, or the host's refusal). */
export type Answer = { status: number; body?: unknown } | Error;

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A host whose requests a test answers. `route` sees every request; it may return a promise to hold an answer back. The
 * answers are real `Response` objects, so the page reads them exactly as it reads the gateway's.
 */
export function fakeHost(route: (call: Call) => Answer | Promise<Answer>) {
  const calls: Call[] = [];
  const opened: PlatformScheduleResultLink[] = [];
  const request = vi.fn(async (path: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? "GET",
      path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = await route(call);
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  const host: PlatformSchedulesHost = {
    request,
    applications: () => HOST_APPS,
    openResult: (link) => void opened.push(link),
  };
  return { host, calls, opened };
}

/** The workbench's request layer throws its refusals with the status and the parsed body. */
export function thrownRefusal(name: string): Error {
  const { status, body } = refusal(name);
  return Object.assign(new Error(`HTTP ${status}`), { status, payload: body });
}

/** No answer at all: the connection dropped. */
export const dropped = () => new TypeError("Failed to fetch");

/** A promise a test settles itself, to hold an answer back while the page goes on. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

export function testI18n() {
  return createI18n({ legacy: false, locale: "en", fallbackLocale: "en", messages: { en } });
}

/**
 * Mount options: the page's text, Element Plus, and overlays drawn in place so a test can read them. Element Plus wraps
 * Vue's teleport in a component of the same name; its stub renders what it carries instead of nothing.
 */
export function pageGlobal() {
  return { plugins: [testI18n(), ElementPlus], stubs: { teleport: true }, renderStubDefaultSlot: true };
}

/** A rendered text with its whitespace flattened, so a card can be asserted in one string. */
export function text(wrapper: { text: () => string }) {
  return wrapper.text().replace(/\s+/g, " ").trim();
}

export { flushPromises, mount };
