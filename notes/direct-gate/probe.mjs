export function installProbe({ direct, initMarks, timeoutMs }) {
  if (window.directGate) return;
  const now = () => performance.timeOrigin + performance.now();
  const normalize = text => text.replace(/\s+/g, " ").trim();
  const label = (el, from) => (from ? el.querySelector(from) : el)?.textContent.replace(/\s+/g, " ").trim();
  const matching = ({ selector, text, textFrom, useAccessibleLabel }) =>
    [...document.querySelectorAll(selector)].filter(el => {
      if (!text) return true;
      const actual = useAccessibleLabel ?
        normalize(el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent) : label(el, textFrom);
      return [text].flat().includes(actual);
    });
  const available = el => el?.isConnected && !el.closest(':disabled,[inert],[aria-disabled="true"]') &&
    getComputedStyle(el).visibility === "visible" && getComputedStyle(el).pointerEvents !== "none" &&
    el.getClientRects().length > 0;
  const point = el => {
    if (!available(el)) return null;
    const { left, right, top, bottom } = el.getBoundingClientRect();
    const x = (Math.max(0, left) + Math.min(innerWidth, right)) / 2;
    const y = (Math.max(0, top) + Math.min(innerHeight, bottom)) / 2;
    return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  };
  const value = el => el.value ?? el.textContent.trim();
  const editable = el => available(el) && !el.readOnly &&
    (el.matches('textarea,input:not([type="hidden"])') || el.isContentEditable);

  function proof(check) {
    if (check.path && location.hash !== "#" + check.path) return null;
    if (check.kind === "control") {
      const predicate = check.scroll ? available : point;
      return matching(check.control).some(predicate) ? { route: location.hash } : null;
    }
    if (check.kind === "list") {
      const rows = matching(check.list.row).filter(available);
      const titles = rows.map(el => label(el, check.list.row.textFrom));
      if (check.titles.some(title => titles.filter(value => value === title).length !== 1)) return null;
      const first = rows.find(el => label(el, check.list.row.textFrom) === check.titles[0]);
      if (!point(check.list.action ? first.querySelector(check.list.action) : first)) return null;
      return { route: location.hash, titles };
    }
    const { form, title } = check;
    const input = document.querySelector(form.input);
    if (!editable(input) || !point(input) || value(input) !== title) return null;
    if (form.ready && !matching(form.ready).some(available)) return null;
    if (form.selected && !matching({ ...form.selected, text: title }).some(available)) return null;
    return { route: location.hash, editableTitle: title };
  }

  function wait(check) {
    return new Promise((resolve, reject) => {
      const deadline = performance.now() + timeoutMs;
      function tick() {
        const ready = proof(check);
        if (ready) return resolve(ready);
        if (performance.now() >= deadline) return reject(new Error("Unusable " + check.kind + " at " + location.hash));
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  const instanceIds = new WeakMap();
  let nextId = 0;
  const instance = () => {
    const el = document.querySelector(direct.root);
    if (!el) return null;
    if (!instanceIds.has(el)) instanceIds.set(el, ++nextId);
    return { el, nodeId: instanceIds.get(el), stamp: direct.instanceAttribute ? el.getAttribute(direct.instanceAttribute) : null };
  };
  const id = entry => entry && { nodeId: entry.nodeId, stamp: entry.stamp };
  let result;
  function arm({ action, check, panel }) {
    const target = matching(action).find(el => point(el));
    if (!target) throw new Error("Click target no longer hit-testable: " + action.selector);
    const previous = panel ? instance() : null;
    const wasReady = panel && check.kind === "form" && proof(check);
    if (wasReady) throw new Error("Target form already editable before clicking");

    let startedAt = null;
    let firstRootAt = null;
    let initialVisibility;
    let previousRemoved = false;
    let stampChanged = false;
    let frameSeen = Boolean(panel && document.querySelector(direct.frame));
    result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clear();
        reject(new Error("No usable " + check.kind + " after trusted click at " + location.hash));
      }, timeoutMs);
      const observer = new MutationObserver(records => {
        if (!startedAt) return;
        if (previous) {
          previousRemoved ||= records.some(record => [...record.removedNodes].some(node => node.contains(previous.el)));
          stampChanged ||= records.some(record => record.target === previous.el && record.attributeName === direct.instanceAttribute);
        }
        frameSeen ||= panel && (Boolean(document.querySelector(direct.frame)) || records.some(record =>
          [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE &&
            (node.matches(direct.frame) || node.querySelector(direct.frame)))));
        if (panel && firstRootAt === null && instance()) firstRootAt = now() - startedAt;
        if (check) tick();
      });
      let animation;
      const clear = () => {
        clearTimeout(timer);
        cancelAnimationFrame(animation);
        observer.disconnect();
        document.removeEventListener("click", click, true);
      };
      function tick() {
        cancelAnimationFrame(animation);
        const usable = proof(check);
        if (!usable) {
          animation = requestAnimationFrame(tick);
          return;
        }
        const endedAt = now();
        const current = panel ? instance() : null;
        clear();
        resolve({
          startedAt, endedAt, proof: usable, frameSeen, initialVisibility, finalVisibility: document.visibilityState,
          root: { before: id(previous), after: id(current), firstSeenMs: firstRootAt,
            removed: previousRemoved, stampChanged },
          marks: performance.getEntriesByType("mark")
            .filter(mark => initMarks.includes(mark.name) && performance.timeOrigin + mark.startTime >= startedAt &&
              performance.timeOrigin + mark.startTime <= endedAt)
            .map(mark => ({ name: mark.name, offsetMs: performance.timeOrigin + mark.startTime - startedAt })),
        });
      }
      function click(event) {
        if (!event.isTrusted || !target.contains(event.target)) return;
        document.removeEventListener("click", click, true);
        startedAt = now();
        if (!check) {
          clear();
          resolve({ startedAt });
          return;
        }
        frameSeen ||= panel && Boolean(document.querySelector(direct.frame));
        initialVisibility = document.visibilityState;
        if (panel && instance()) firstRootAt = 0;
        animation = requestAnimationFrame(tick);
      }
      document.addEventListener("click", click, true);
      if (check) {
        observer.observe(document.documentElement, { childList: true, subtree: true,
          characterData: true, attributes: true });
      }
    });
    result.catch(() => {});
  }

  window.directGate = {
    ready: wait,
    root: () => id(instance()),
    point(action) {
      const el = matching(action).find(available);
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return point(el);
    },
    arm,
    result: () => result,
  };
}
