import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import declarationP from "./p/declaration.mjs";
import declarationQ from "./q/declaration.mjs";

/*
 * Everything this trial registers, in the order it is registered: four projections used by two panels, the two panels
 * themselves, and the two applications that use them.
 *
 * A projection is one base component bound to one element, with its own display and its inputs — and nothing about who
 * draws it or where. X is the summary of one scheduled task; P and Q both use it, so changing its display changes both.
 * The other projections are P's alone.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const text = (path) => readFileSync(join(HERE, path), "utf8");

const projection = (id, name, description, componentId, binding, inputs, display = {}) => ({
  id,
  input: { name, description, visibility: "domain", componentId, binding, inputs, display },
});

export const projections = [
  // X: one scheduled task, summed up. Both panels show it.
  projection(
    "projection-schedules-summary",
    "Task summary",
    "One scheduled task as a reader recognises it: its application, its settings, whether it is on, and when it runs next.",
    "ObjectSummary",
    { kind: "PlatformObjectType", id: "platform:ScheduledTask" },
    { task: { kind: "object", objectType: "platform:ScheduledTask" } },
    { fields: ["application", "settings", "state", "nextRun"] },
  ),
  // P's list: the reader's tasks, the platform's own objects.
  projection(
    "projection-schedules-tasks",
    "Scheduled tasks",
    "The reader's scheduled tasks, to choose one from.",
    "ObjectList",
    { kind: "PlatformObjectType", id: "platform:ScheduledTask" },
    { value: { kind: "object", objectType: "platform:ScheduledTask" } },
  ),
  // P's form: one task, through its own application's form.
  projection(
    "projection-schedules-form",
    "Task form",
    "One scheduled task's form, as the application it belongs to declares it.",
    "ObjectForm",
    { kind: "PlatformObjectType", id: "platform:ScheduledTask" },
    { task: { kind: "object", objectType: "platform:ScheduledTask" } },
  ),
  // P's button: the platform's own operation to run a task now.
  projection(
    "projection-schedules-run",
    "Run now",
    "Runs the chosen scheduled task now, leaving its schedule as it is.",
    "OperationButton",
    { kind: "PlatformOperation", id: "schedules.runNow" },
    { task: { kind: "object", objectType: "platform:ScheduledTask" } },
  ),
];

/** The two panels, each with its own text and the declaration its module exports. */
export const panels = [
  {
    id: "panel-schedules-trial",
    directory: "p",
    manifest: declarationP,
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

/** A panel's text: its HTML and its module, with an optional recipes text when the directory has one. */
export function panelContent(directory) {
  const recipes = join(HERE, directory, "recipes.md");
  return {
    html: text(join(directory, "panel.html")),
    module: text(join(directory, "panel.mjs")),
    ...(existsSync(recipes) ? { recipes: readFileSync(recipes, "utf8") } : {}),
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
