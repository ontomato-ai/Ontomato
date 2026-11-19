function occupied(intervals) {
  const ordered = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort(([a], [b]) => a - b);
  let total = 0, tail = 0;
  for (const [start, end] of ordered) {
    total += Math.max(0, end - Math.max(tail, start));
    tail = Math.max(tail, end);
  }
  return total;
}

export function network(events, start, end, patterns) {
  const matchers = Object.fromEntries(Object.entries(patterns).map(([kind, values]) =>
    [kind, values.map(value => new RegExp(value))]));
  const requests = new Map();
  const redirects = [];
  for (const { method, params: p } of events) {
    if (!method.startsWith("Network.")) continue;
    if (method === "Network.requestWillBeSent") {
      if (!p.request.url.startsWith("http")) continue;
      const begin = p.wallTime * 1000;
      if (begin < start || begin > end) continue;
      const prior = requests.get(p.requestId);
      if (prior && p.redirectResponse) {
        prior.encodedBytes = Math.max(0, p.redirectResponse.encodedDataLength);
        prior.finishMs = (p.timestamp - prior.clock) * 1000 + prior.startMs;
        prior.status = p.redirectResponse.status;
        redirects.push(prior);
        requests.delete(p.requestId);
      }
      const path = new URL(p.request.url).pathname;
      const kind = Object.keys(matchers).find(key => matchers[key].some(re => re.test(path))) ?? "other";
      requests.set(p.requestId, { method: p.request.method, path, kind, initiator: p.initiator.type,
        clock: p.timestamp, startMs: begin - start, encodedBytes: 0, bodyBytes: 0, finishMs: null, cached: false });
      continue;
    }
    const row = requests.get(p.requestId);
    if (!row) continue;
    const at = row.startMs + (p.timestamp - row.clock) * 1000;
    if (at > end - start) continue;
    if (method === "Network.requestServedFromCache") row.cached = true;
    if (method === "Network.responseReceived") {
      const r = p.response;
      row.status = r.status;
      row.headersAtMs = at;
      row.cached ||= Boolean(r.fromDiskCache || r.fromServiceWorker || r.fromPrefetchCache);
      row.encodedBytes = Math.max(0, r.encodedDataLength);
      row.connectionId = r.connectionId;
      row.connectionReused = r.connectionReused;
      row.protocol = r.protocol;
      row.timing = r.timing ?? null;
    }
    if (method === "Network.dataReceived") {
      const bytes = Math.max(0, p.encodedDataLength);
      row.bodyBytes += bytes;
      row.encodedBytes += bytes;
      if (bytes) row.bodyEndMs = at;
    }
    if (method === "Network.loadingFinished") {
      row.finishMs = at;
      row.encodedBytes = Math.max(0, p.encodedDataLength);
    }
    if (method === "Network.loadingFailed") row.failed = p.errorText;
  }
  const rows = [...redirects, ...requests.values()].map(({ clock, ...row }) => ({
    ...row, encodedBytes: row.cached ? 0 : row.encodedBytes, bodyBytes: row.cached ? 0 : row.bodyBytes,
  })).sort((a, b) => a.startMs - b.startMs);
  const phases = Object.fromEntries(Object.keys(matchers).map(kind => {
    const subset = rows.filter(row => row.kind === kind);
    return [kind, { requests: subset.length, bytes: subset.reduce((sum, row) => sum + row.encodedBytes, 0),
      bodyBytes: subset.reduce((sum, row) => sum + row.bodyBytes, 0),
      occupiedMs: occupied(subset.map(row => [row.startMs, row.finishMs ?? end - start])),
      bodyMs: occupied(subset.filter(row => row.bodyBytes).map(row => [row.headersAtMs, row.bodyEndMs])),
    }];
  }));
  return { downloadBytes: rows.reduce((sum, row) => sum + row.encodedBytes, 0), phases, requests: rows };
}
