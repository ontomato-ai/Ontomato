import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import type { LiveLogFilter } from "./types";
import { workbenchLogging } from "../../../logging/logger";
import { observedRecord, queryOntologyServiceLogs, readServiceLogWindow } from "./service-logs";
const closers = new Set<() => void>();
let sequence = 0;
const recent: Array<{ seq: number; record: ParsedLogRecord }> = [];
function matches(record: ParsedLogRecord, filter: LiveLogFilter) {
  return (!filter.source?.length || filter.source.includes(record.source))
    && (!filter.level?.length || (record.level && filter.level.includes(record.level)))
    && (!filter.keyword || record.message.toLowerCase().includes(filter.keyword.toLowerCase()));
}
export function subscribeLiveLogs(_id: string, filter: LiveLogFilter, send: (seq: number, record: ParsedLogRecord) => void, close: () => void, options: { token?: string } = {}): () => void {
  const seen = new Set<string>();
  let stopped = false, running = false, since = Date.now();
  const emit = (record: ParsedLogRecord) => {
    if (stopped || (record.logId && seen.has(record.logId))) return;
    if (record.logId) seen.add(record.logId);
    if (seen.size > 4000) seen.delete(seen.values().next().value!);
    let entry = record.logId ? recent.find(item => item.record.logId === record.logId) : undefined;
    if (!entry) {
      entry = { seq: ++sequence, record }; recent.push(entry);
      if (recent.length > 2000) recent.shift();
    }
    if (matches(record, filter)) send(entry.seq, record);
  };
  if (filter.sinceSeq !== undefined) {
    if (recent.length && filter.sinceSeq < recent[0].seq - 1) send(-1, { source: "backend", level: "warn", message: "log_gap: requested sequence is outside the retained live buffer" });
    for (const entry of recent) if (entry.seq > filter.sinceSeq && matches(entry.record, filter)) {
      send(entry.seq, entry.record); if (entry.record.logId) seen.add(entry.record.logId);
    }
  }
  const unsubscribe = workbenchLogging.subscribe(record => emit(observedRecord(record, "workbench")));
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (running || stopped || (filter.source?.length && !filter.source.includes("backend"))) return;
    running = true;
    const until = Date.now();
    void readServiceLogWindow({ from: new Date(since - 5000).toISOString(), to: new Date(until).toISOString() },
      q => queryOntologyServiceLogs(q, { ...options, signal: controller.signal }), controller.signal)
      .then(records => { records.forEach(emit); since = until; })
      .catch(() => { if (!stopped) { cleanup(); close(); } })
      .finally(() => { running = false; });
  }, 2000).unref();
  function cleanup() { stopped = true; clearInterval(timer); unsubscribe(); controller.abort(); closers.delete(cleanup); }
  closers.add(cleanup);
  return cleanup;
}
export function shutdownLiveLogs(): void { for (const close of closers) close(); }
export function refreshLiveLogSources(): void { shutdownLiveLogs(); }
