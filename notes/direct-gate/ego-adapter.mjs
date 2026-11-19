export function egoAdapter(task) {
  const page = task.page("p1");
  return {
    cdp: (method, params) => page.cdp(method, params),
    goto: url => page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }),
    events: () => page.events(),
    evaluate: (fn, arg) => arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg),
  };
}
