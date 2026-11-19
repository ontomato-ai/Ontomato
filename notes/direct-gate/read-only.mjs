export function suppressNavigationWrites(origin) {
  if (location.origin !== origin || window.m1NavigationWritesSuppressed) return;

  const fetch = window.fetch.bind(window);
  const suppressed = [];
  window.m1NavigationWritesSuppressed = suppressed;
  window.fetch = function (input, init) {
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (url.origin === origin && method === "POST") {
      if (url.pathname === "/api/data-query/platform/scheduled-tasks/credential/renew") {
        suppressed.push({ at: performance.timeOrigin + performance.now(), method, path: url.pathname, kind: "credential-renew" });
        // Native entry waits for this call. Answer locally because renewal can resume other tasks on the account.
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const app = url.pathname.match(/^\/api\/platform\/home\/applications\/([^/]+)\/open$/);
      if (app || url.pathname === "/api/personal-workspace/recent") {
        suppressed.push({ at: performance.timeOrigin + performance.now(), method, path: url.pathname,
          kind: app ? "application-open" : "recent-visit" });
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
