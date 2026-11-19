export function suppressNavigationWrites(origin) {
  if (location.origin !== origin || window.m1NavigationWritesSuppressed) return;

  const fetch = window.fetch.bind(window);
  const suppressed = [];
  window.m1NavigationWritesSuppressed = suppressed;
  window.fetch = function (input, init) {
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (url.origin === origin && method === "POST") {
      const app = url.pathname.match(/^\/api\/platform\/home\/applications\/([^/]+)\/open$/);
      if (app || url.pathname === "/api/personal-workspace/recent") {
        suppressed.push({ at: performance.timeOrigin + performance.now(), path: url.pathname });
        // Both calls are detached bookkeeping. Keep their response contract
        // without sending the request to the shared account's history.
        const at = new Date().toISOString();
        const result = app ? { applicationId: decodeURIComponent(app[1]), lastOpenedAt: at } :
          { data: { ...JSON.parse(init.body), visitedAt: at } };
        return Promise.resolve(Response.json(result));
      }
    }
    return fetch(input, init);
  };
}
