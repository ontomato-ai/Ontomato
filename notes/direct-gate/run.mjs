import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { connect } from "./cdp.mjs";
import { egoAdapter } from "./ego-adapter.mjs";
import { suppressNavigationWrites } from "./read-only.mjs";
import { network } from "./network.mjs";
import { installProbe } from "./probe.mjs";

const viewport = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const stages = { smoke: 2, formal: 10 };
const hash = values => createHash("sha256").update(JSON.stringify(values)).digest("hex");

function checkDeadline(config) {
  if (!(Date.now() < Date.parse(config.deadline))) throw new Error("Frozen measurement window expired");
}

export async function settings(configPath, stage, flag) {
  if (flag !== "--window-open" || !(stage in stages)) throw new Error("Expected smoke|formal --window-open");
  const config = JSON.parse(await readFile(configPath));
  checkDeadline(config);
  const origin = new URL(config.origin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== config.origin ||
      !Object.values(config.revisions).every(value => /^[a-f0-9]{7,40}$/.test(value)) ||
      Object.keys(config.revisions).sort().join(",") !== "enterprise,ontomato") {
    throw new Error("Expected an HTTP origin and both frozen revisions");
  }
  const selectors = [config.away.leave.selector, config.panel.enter.selector, config.panel.list.row.selector,
    config.panel.form.input, config.panel.form.selected.selector, config.panel.form.ready.selector, config.direct.root];
  if (config.tasks.length !== 2 || new Set(config.tasks).size !== 2 || !config.tasks.every(title => title.startsWith("e2e-")) ||
      !config.panel.path.startsWith("/applications/") || selectors.some(selector => !selector.trim()) ||
      !config.identity.account || !config.device || !config.linkFile) {
    throw new Error("Expected two distinct e2e- task titles and the direct host, device, and link settings");
  }
  return config;
}

async function build(config) {
  checkDeadline(config);
  const response = await fetch(config.origin + "/api/health");
  if (!response.ok) throw new Error("Health status " + response.status);
  const { build } = await response.json();
  for (const [id, revision] of Object.entries(config.revisions)) {
    if (!build.sources.find(source => source.id === id)?.revision.startsWith(revision)) {
      throw new Error("Frozen " + id + " revision differs from the authorized window");
    }
  }
  return build;
}

async function metrics(page) {
  return Object.fromEntries((await page.cdp("Performance.getMetrics")).metrics.map(item => [item.name, item.value]));
}

const call = (page, method, arg) => page.evaluate(([method, arg]) => window.directGate[method](arg), [method, arg]);

async function reset(page, config, variant) {
  await page.goto("about:blank");
  await page.events();
  const openedAt = Date.now();
  await page.goto(config.origin + "/#" + config.away.path);
  const deadline = Date.now() + config.timeoutMs;
  while (!(await page.evaluate(path => Boolean(window.directGate && location.hash === "#" + path), config.away.path))) {
    if (Date.now() >= deadline) throw new Error("Start document did not commit at " + config.away.path);
    await wait(50);
  }
  await call(page, "ready", { kind: "control", path: config.away.path, control: variant.enter, scroll: true });
  return openedAt;
}

async function prepareInput(page, action) {
  await call(page, "ready", { kind: "control", control: action, scroll: true });
  const point = await call(page, "point", action);
  if (!point) throw new Error("Click lacks a hit point: " + action.selector);
  return point;
}

async function input(page, action, check, panel, point) {
  point ??= await prepareInput(page, action);
  await call(page, "arm", { action, check, panel });
  await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  return call(page, "result");
}

async function timed(page, config, action, check, panel, openedAt) {
  checkDeadline(config);
  const point = await prepareInput(page, action);
  const before = await metrics(page);
  const priorEvents = await page.events();
  const observation = await input(page, action, check, panel, point);
  const after = await metrics(page);
  const events = await page.events();
  const { startedAt, endedAt, proof, root } = observation;
  const delta = (...keys) => keys.reduce((sum, key) => sum + (after[key] - before[key]) * 1000, 0);
  if (![delta("TaskDuration"), delta("Timestamp")].every(Number.isFinite)) {
    throw new Error("CDP Performance metrics unavailable");
  }
  if (panel && check.kind !== "control" && (observation.frameSeen || !root.after || root.after.stamp === "" ||
      ((config.direct.instanceAttribute || config.direct.vueRoot) && root.after.stamp === null))) {
    throw new Error("Registered entry did not prove direct rendering");
  }
  if (proof.titles) {
    proof.listCount = proof.titles.length;
    proof.listFingerprint = hash(proof.titles.sort());
    delete proof.titles;
  }
  return {
    ...observation, durationMs: endedAt - startedAt, mainThreadBusyMs: delta("TaskDuration"),
    mainThreadWindowMs: delta("Timestamp"), scriptMs: delta("ScriptDuration"),
    layoutStyleMs: delta("LayoutDuration", "RecalcStyleDuration"),
    instanceRebuilt: root.before && root.after ?
      root.removed || root.stampChanged || root.before.nodeId !== root.after.nodeId || root.before.stamp !== root.after.stamp : null,
    ...network([...priorEvents, ...events], startedAt, endedAt, config.requests),
    ...(openedAt ? { preClick: network([...priorEvents, ...events], openedAt, startedAt, config.requests) } : {}),
  };
}

function listCheck(config, variant) {
  return { kind: "list", path: variant.path, list: variant.list, titles: config.tasks };
}

function formCheck(variant, title, taskKeys) {
  return { kind: "form", form: variant.form, title, taskKey: taskKeys[title] };
}

function choose(variant, title) {
  return { ...variant.list.row, text: title };
}

async function prepareSwitch(page, config, variant, panel, taskKeys) {
  const [first, second] = config.tasks;
  const firstForm = formCheck(variant, first, taskKeys);
  if (panel) {
    // An existing selection is allowed only if it really is the first task.
    if (!(await call(page, "check", firstForm))) {
      await input(page, choose(variant, first), firstForm, true);
    }
    await call(page, "ready", firstForm);
    return choose(variant, second);
  }

  const openMenu = async title => {
    const ariaLabel = await page.evaluate(({ row, title, button }) => {
      const card = [...document.querySelectorAll(row.selector)].find(el => el.querySelector(row.textFrom)?.textContent.trim() === title);
      return card?.querySelector(button)?.getAttribute("aria-label");
    }, { row: variant.list.row, title, button: variant.list.action });
    if (!ariaLabel) throw new Error("Native edit menu missing for the chosen task");
    const selector = variant.list.row.selector + " " + variant.list.action + "[aria-label=" + JSON.stringify(ariaLabel) + "]";
    await input(page, { selector }, null, false);
  };
  await openMenu(first);
  await input(page, variant.edit, firstForm, false);
  await input(page, variant.close, listCheck(config, variant), false);
  await openMenu(second);
  return variant.edit;
}

export async function benchmark(page, config, { count, save, saveSuppressed }) {
  await page.cdp("Page.enable");
  await page.cdp("Network.enable");
  await page.cdp("Performance.enable");
  await page.cdp("Emulation.setDeviceMetricsOverride", viewport);
  const probe = { direct: config.direct, initMarks: config.initMarks, timeoutMs: config.timeoutMs };
  const injection = await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: "(" + suppressNavigationWrites + ")(" + JSON.stringify(config.origin) + ");(" + installProbe + ")(" + JSON.stringify(probe) + ");",
  });

  try {
    await reset(page, config, config.native);
    if (config.identity) {
      const identity = await page.evaluate(async ({ path, tokenKey }) => {
        const tk = localStorage.getItem(tokenKey);
        if (!tk) return null;
        const response = await fetch(path, { method: "POST", headers: {
          tk, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest",
        }, body: JSON.stringify({ tk }) });
        if (!response.ok) return null;
        const { data } = await response.json();
        return data && { account: data.loginCode, domainId: data.domainId };
      }, config.identity);
      if (identity?.account !== config.identity.account || String(identity.domainId) !== config.identity.domainId) {
        throw new Error("Session is outside the configured account/domain");
      }
    }
    let taskKeys = {};
    for (let round = 1; round <= count; round++) {
      const pair = [];
      const order = round % 2 ? ["native", "panel"] : ["panel", "native"];
      for (const lane of order) {
        checkDeadline(config);
        const openedAt = await reset(page, config, config[lane]);
        const variant = config[lane];
        const panel = lane === "panel";
        const capture = async (step, action, check) => {
          const sample = { round, lane, step,
            ...await timed(page, config, action, check, panel, step === "first" ? openedAt : null) };
          if (sample.proof.taskKeys) {
            if (config.tasks.some(title => taskKeys[title] && taskKeys[title] !== sample.proof.taskKeys[title])) {
              throw new Error("A configured task changed ID during measurement");
            }
            taskKeys = sample.proof.taskKeys;
          }
          pair.push(sample);
          await save(sample);
        };
        try {
          const list = listCheck(config, variant);
          await capture("first", variant.enter, list);
          await capture("away", config.away.leave, { kind: "control", path: config.away.path, control: variant.enter, scroll: true });
          await capture("return", variant.enter, list);
          const select = await prepareSwitch(page, config, variant, panel, taskKeys);
          await capture("switch", select, formCheck(variant, config.tasks[1], taskKeys));
        } finally {
          const excluded = await page.evaluate(() => window.m1NavigationWritesSuppressed);
          await saveSuppressed(excluded.map(request => ({ round, lane, ...request })));
        }
      }
      const fingerprints = new Set(pair.filter(sample => sample.proof.listFingerprint).map(sample => sample.proof.listFingerprint));
      if (fingerprints.size !== 1) throw new Error("Visible task inventory differs across lanes or entry points");
    }
  } finally {
    await page.cdp("Page.removeScriptToEvaluateOnNewDocument", injection);
    await page.cdp("Emulation.clearDeviceMetricsOverride");
  }
}

export async function run(page, configPath, stage, outPath, group, flag) {
  const config = await settings(configPath, stage, flag);
  const buildAtStart = await build(config);
  const browser = { product: await page.evaluate(() => navigator.userAgent) };
  const { [group]: link, asset } = JSON.parse(await readFile(config.linkFile));
  const output = { stage, group, build: buildAtStart, viewport, browser, link, asset, device: config.device[group],
    identity: { account: config.identity.account, domainId: config.identity.domainId }, tasks: config.tasks,
    lifecycleSource: config.direct.lifecycleSource, instanceAttribute: config.direct.instanceAttribute,
    vueRoot: config.direct.vueRoot,
    route: { native: config.native.path, panel: config.panel.path, away: config.away.path },
    requestClassification: config.requests,
    startedAt: new Date().toISOString(), count: stages[stage], samples: [], suppressedRequests: [] };
  if (!link?.bytes || !output.device) throw new Error("Missing device or measured connection");
  await mkdir(resolve(outPath, ".."), { recursive: true });
  const save = () => writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  try {
    await benchmark(page, config, {
      count: output.count,
      save: async sample => {
        output.samples.push(sample);
        await save();
      },
      saveSuppressed: async requests => {
        output.suppressedRequests.push(...requests);
        await save();
      },
    });
    output.endingBuild = await build(config);
    if (JSON.stringify(output.endingBuild) !== JSON.stringify(buildAtStart)) throw new Error("Build changed during acquisition");
    output.completed = true;
  } finally {
    output.finishedAt = new Date().toISOString();
    await save();
  }
  return { group, stage, samples: output.samples.length };
}

export async function runEgo(task, args) {
  const result = await run(egoAdapter(task), ...args, "ego", "--window-open");
  console.log(JSON.stringify({ ...result, spaceId: task.spaceId }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, flag, config, out, port] = process.argv.slice(2);
  await settings(config, stage, flag);
  const page = await connect(Number(port));
  try {
    console.log(await run(page, resolve(config), stage, resolve(out), "lan", flag));
  } finally {
    page.close();
  }
}
