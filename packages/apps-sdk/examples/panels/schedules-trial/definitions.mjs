import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import declarationQ from "./q/declaration.mjs";

/*
 * Everything this trial registers, in the order it is registered: four projections used by two panels, the two panels
 * themselves, and the two applications that use them.
 *
 * A projection is one SDK component with the data it shows, each item a read its owner registered (the scheduled task's
 * list, record, form and run-now description), and nothing about who draws it or where. X is the summary of one
 * scheduled task; P and Q both use it, so changing its display changes both. The other projections are P's alone.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const text = (path) => readFileSync(join(HERE, path), "utf8");

const TASK = "platform:ScheduledTask";
const task = { kind: "object", objectType: TASK };
const read = (source, name, params = {}) => ({ source, read: name, params });

const projection = (id, name, description, component, ports) => ({
  id,
  input: { name, description, visibility: "domain", componentId: `@ontomato/sdk:${component}`, inputs: {}, outputs: {}, config: {}, ...ports },
});

export const projections = [
  // X: one scheduled task, summed up. Both panels show it.
  projection(
    "projection-schedules-summary",
    "Task summary",
    "One scheduled task as a reader recognises it: its application, its settings, whether it is on, and when it runs next.",
    "ObjectSummary",
    {
      inputs: { task },
      data: { record: read({ object: { input: "task" } }, "record") },
      config: { fields: ["application", "settings", "state", "nextRun"] },
    },
  ),
  // P's list: the reader's tasks, the platform's own objects, and the one chosen.
  projection(
    "projection-schedules-tasks",
    "Scheduled tasks",
    "The reader's scheduled tasks, to choose one from.",
    "ObjectList",
    { outputs: { selected: task }, data: { rows: read({ type: { kind: "PlatformObjectType", id: TASK } }, "list") } },
  ),
  // P's form: one task, through its own application's form; the form asks again with the values a changed field depends on.
  projection(
    "projection-schedules-form",
    "Task form",
    "One scheduled task's form, as the application it belongs to declares it.",
    "ObjectForm",
    {
      inputs: { task },
      data: { form: read({ object: { input: "task" } }, "form") },
    },
  ),
  // P's button: the platform's own operation to run a task now.
  projection(
    "projection-schedules-run",
    "Run now",
    "Runs the chosen scheduled task now, leaving its schedule as it is.",
    "OperationButton",
    { inputs: { task }, data: { operation: read({ operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, "describe") } },
  ),
];

/**
 * The two panels, each a Vue component (`panel.html`'s `#app` template and `panel.mjs`) with its declaration: P's in
 * `p/panel.json`, Q's in `q/declaration.mjs`.
 */
export const panels = [
  {
    id: "panel-schedules-trial",
    directory: "p",
    manifest: JSON.parse(text("p/panel.json")),
    name: "Scheduled tasks (trial)",
    description: "Pick one of the reader's scheduled tasks, change it through its application's form, save it, and run it now.",
  },
  {
    id: "panel-schedules-summary",
    directory: "q",
    manifest: declarationQ,
    name: "Task summary (trial)",
    description: "One scheduled task as a reader recognises it, for the task its address names.",
  },
];

/** A panel's text: its HTML, its module, and its recipes when the directory has them. */
export function panelContent(directory) {
  const recipes = join(directory, "recipes.md");
  return {
    html: text(join(directory, "panel.html")),
    module: text(join(directory, "panel.mjs")),
    ...(existsSync(join(HERE, recipes)) ? { recipes: text(recipes) } : {}),
  };
}

/**
 * The two acceptance applications and their use relations. Both are panel applications from creation (Java refuses to
 * turn an existing application into one): A shows P, B shows P and Q. Each relation has its own stable `pageKey`, none of
 * them the dashboard's or the scheduled tasks' own, and every one of them is open to the domain's members, since these
 * are trial applications open to domain members. Only B has two named menu entries. A relation's path is inside its application, so the platform opens
 * A's panel at `/applications/app-panels-trial-a/tasks` and B's two at `/applications/app-panels-trial-b/tasks` and
 * `/applications/app-panels-trial-b/summary`.
 */
const use = (id, pageKey, panelId, path, names) => ({
  id,
  pageKey,
  panelId,
  path,
  access: { kind: "domain-member" },
  names,
});

export const applications = [
  {
    applicationId: "app-panels-trial-a",
    entry: { path: "/applications/app-panels-trial-a", renderer: "panels" },
    entryAccess: ["domain-member"],
    declaration: {
      names: { en: "Panels trial A", "zh-CN": "面板试点 A" },
      descriptions: { en: "The scheduled tasks panel, as the first trial application.", "zh-CN": "定时任务面板，第一个试点应用。" },
      icon: "schedules",
      groups: [],
      permissions: [],
    },
    panelUses: [use("use-trial-a-tasks", "panels-trial-a-tasks", "panel-schedules-trial", "/applications/app-panels-trial-a/tasks", { en: "Scheduled tasks", "zh-CN": "定时任务" })],
  },
  {
    applicationId: "app-panels-trial-b",
    entry: { path: "/applications/app-panels-trial-b", renderer: "panels" },
    entryAccess: ["domain-member"],
    declaration: {
      names: { en: "Panels trial B", "zh-CN": "面板试点 B" },
      descriptions: { en: "The same scheduled tasks panel, and a second panel that shows one task.", "zh-CN": "同一个定时任务面板，另加一个只显示一个任务的面板。" },
      icon: "schedules",
      groups: [],
      permissions: [],
    },
    panelUses: [
      use("use-trial-b-tasks", "panels-trial-b-tasks", "panel-schedules-trial", "/applications/app-panels-trial-b/tasks", { en: "Scheduled tasks", "zh-CN": "定时任务" }),
      use("use-trial-b-summary", "panels-trial-b-summary", "panel-schedules-summary", "/applications/app-panels-trial-b/summary", { en: "Task summary", "zh-CN": "任务摘要" }),
    ],
  },
];
