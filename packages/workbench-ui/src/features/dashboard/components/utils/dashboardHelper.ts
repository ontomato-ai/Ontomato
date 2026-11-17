// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {
  fetchDashboardLocalDetail,
  queryDashboardCard,
} from "../../api";
import { cardFailed, cardLoaded, cardLoading, patchCard } from "./metricCard";
import { queryViewApi } from "../../../query-view";

/* ======================== Basic utility functions ======================== */

export function normalizeId(v) {
  return String(v || "").trim();
}

export function isAbortError(e) {
  if (!e) return false;
  if (e?.name === "AbortError") return true;
  const msg = typeof e?.message === "string" ? e.message : "";
  return msg.includes("AbortError") || msg.includes("aborted");
}

export async function fetchClassMetas() {
  try {
    const json = await queryViewApi.getMetas();
    const def = Array.isArray(json?.data?.classDef) ? json.data.classDef : [];

    const cmap = {};
    for (const d of def) {
      if (!d?.className) continue;
      const perClass = {};
      for (const a of Array.isArray(d?.attrs) ? d.attrs : []) {
        if (!a?.name) continue;
        perClass[a.name] = a.showName || a.attrDesc || a.name;
      }
      cmap[d.className] = perClass;
    }

    return cmap;
  } catch {
    return {};
  }
}

/* ======================== Concurrency control ======================== */

export async function runTaskPool(tasks, concurrency, signal) {
  const max = Math.max(1, Math.floor(concurrency || 1));
  let cursor = 0;

  const workers = Array.from({ length: Math.min(max, tasks.length) }, async () => {
    while (true) {
      if (signal?.aborted) return;
      const idx = cursor++;
      if (idx >= tasks.length) return;
      await tasks[idx]();
    }
  });

  await Promise.all(workers);
}

/* ======================== Patch series (pure functions) ======================== */

export function patchDimensionTitle(groups, groupId, nextTitle) {
  const title = String(nextTitle || "").trim();
  if (!groupId || !title) return groups;

  return groups.map((g) => {
    const gid = normalizeId(g?.id || "");
    return gid === groupId ? { ...g, title } : g;
  });
}

export function patchDeleteDimension(groups, groupId) {
  if (!groupId) return groups;
  return groups.filter((g) => normalizeId(g?.id || "") !== groupId);
}

export function patchChartTitle(groups, chartId, nextTitle) {
  const cid = normalizeId(chartId);
  const title = String(nextTitle || "").trim();
  if (!cid || !title) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;
    return {
      ...g,
      charts: g.charts.map((c) => (normalizeId(c?.id) === cid ? { ...c, title } : c)),
    };
  });
}

export function patchDeleteChart(groups, chartId) {
  const cid = normalizeId(chartId);
  if (!cid) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;

    return {
      ...g,
      charts: g.charts.filter((c) => normalizeId(c?.id) !== cid),
    };
  });
}

/**
 * The data engine's partial-result marker of one widget refresh response; complete results have
 * none. The widget keeps it beside the rows it shows.
 */
export function refreshTruncation(response) {
  return response?.truncated
    ? {
        truncated: true,
        rowLimit: response.rowLimit,
        truncationHint: response.truncationHint,
      }
    : undefined;
}

/** The localized partial-result header followed by the data engine's hint verbatim; "" when complete. */
export function partialResultNotice(truncation, t) {
  return truncation?.truncated
    ? `${t("chat.partialResult", { rowLimit: truncation.rowLimit })} ${truncation.truncationHint}`
    : "";
}

export function patchMetricTitle(groups, metricId, nextTitle) {
  const mid = normalizeId(metricId);
  const name = String(nextTitle || "").trim();
  if (!mid || !name) return groups;

  return groups.map((g) => {
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    if (!metrics.length) return g;

    return {
      ...g,
      metrics: metrics.map((m) => {
        return normalizeId(m?.id) === mid ? { ...m, name } : m;
      }),
    };
  });
}

export function patchDeleteMetric(groups, metricId) {
  const mid = normalizeId(metricId);
  if (!mid) return groups;

  return groups.map((g) => {
    if (!g) return g;
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    if (!metrics.length) return g;
    const nextMetrics = metrics.filter((m) => normalizeId(m?.id) !== mid);
    return nextMetrics.length === metrics.length ? g : { ...g, metrics: nextMetrics };
  });
}

/* ======================== Dashboard loading ======================== */

/**
 * Fetches one metric-reference card's result by its id and patches it back; a failure shows on that card only.
 * The card's saved query is the server's: nothing of it is sent from here.
 */
export function metricCardTask(dashboardId, cardId, setGroups, guard = () => true) {
  return async () => {
    if (!guard()) return;
    setGroups((prev) => patchCard(prev, cardId, cardLoading));
    try {
      const data = await queryDashboardCard(dashboardId, cardId);
      if (!guard()) return;
      setGroups((prev) => patchCard(prev, cardId, (card) => cardLoaded(card, data)));
    } catch (e) {
      if (!guard()) return;
      setGroups((prev) => patchCard(prev, cardId, (card) => cardFailed(card, e)));
    }
  };
}

export function createDashboardLoader() {
  let abortController = null;
  let loadSeq = 0;

  function abort() {
    abortController?.abort();
  }

  /**
   * @param {string} id
   * @param {(updater: any) => void} setGroups  - React setState or a similar signature: setGroups(next) / setGroups(prev => next)
   */
  async function loadDashboardById(id, setGroups) {
    if (abortController) abortController.abort();
    abortController = new globalThis.AbortController();
    const signal = abortController.signal;
    const seq = ++loadSeq;

    const guard = () => seq === loadSeq && !signal.aborted;

    // 1) Fetch local config
    let detail;
    try {
      detail = await fetchDashboardLocalDetail(id, { signal });
    } catch (e) {
      if (isAbortError(e)) return;
      // If you want to clear the UI: setGroups([]) also works
      setGroups([]);
      return;
    }
    if (!guard()) return;

    const localGroups = Array.isArray(detail?.groups) ? detail.groups : [];

    // 2) First build the "render-state structure" (every card starts in loading)
    const { renderGroups, tasks } = buildRenderModelAndTasks({ dashboardId: id, localGroups, setGroups, guard });

    // 3) First render the structure (loading)
    setGroups(renderGroups);

    // 4) Run tasks concurrently: fetch each card's data and patch it back
    try {
      await runTaskPool(tasks, 4, signal); // concurrency is adjustable
    } catch (e) {
      // taskPool itself may throw on abort depending on your implementation; fall back here
      if (isAbortError(e)) return;
    }
  }

  return { loadDashboardById, abort };
}

/** Map groups into a renderable structure and generate one data task per card. */
function buildRenderModelAndTasks({ dashboardId, localGroups, setGroups, guard }) {
  const renderGroups = [];
  const tasks = [];
  for (const g of localGroups) {
    const charts = Array.isArray(g?.charts) ? g.charts : [];
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];

    const renderCharts = charts.map((c) => {
      tasks.push(metricCardTask(dashboardId, c.id, setGroups, guard));
      return { ...c, title: c.name, state: "loading" };
    });
    const renderMetrics = metrics.map((m) => {
      tasks.push(metricCardTask(dashboardId, m.id, setGroups, guard));
      return { ...m, state: "loading" };
    });

    renderGroups.push({
      title: String(g?.title || "").trim(),
      id: normalizeId(g?.id),
      charts: renderCharts,
      metrics: renderMetrics,
    });
  }

  return { renderGroups, tasks };
}

export function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export function parseGridColumns(el) {
  if (!el) return { colCount: 1, colWidth: el?.clientWidth || 1, gap: 0 };
  const cs = globalThis.getComputedStyle(el);
  const cols = (cs.gridTemplateColumns || "").split(" ").filter(Boolean);
  const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;

  const colCount = Math.max(1, cols.length || 1);
  const total = el.clientWidth;
  const colWidth = colCount > 0 ? (total - gap * (colCount - 1)) / colCount : total;
  return { colCount, colWidth, gap };
}
