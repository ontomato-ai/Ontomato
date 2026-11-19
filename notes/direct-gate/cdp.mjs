export async function connect(port) {
  const [page] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(target => target.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  let events = [];
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.method?.startsWith("Network.") || response.method?.startsWith("Target.") || response.method?.startsWith("Tracing.")) events.push(response);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error("CDP socket closed"));
    pending.clear();
  });

  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    cdp,
    async evaluate(fn, arg, contextId) {
      const response = await cdp("Runtime.evaluate", {
        contextId,
        expression: `(${fn})(${JSON.stringify(arg)})`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    async goto(url) {
      const response = await cdp("Page.navigate", { url });
      if (response.errorText) throw new Error(response.errorText);
    },
    events() {
      const buffered = events;
      events = [];
      return buffered;
    },
    close: () => socket.close(),
  };
}
