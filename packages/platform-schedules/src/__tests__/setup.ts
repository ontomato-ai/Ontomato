/*
 * happy-dom has no layout, so a Node's offsetHeight stays undefined; Element Plus's auto-growing textarea reads it from
 * a queued tick, which can land after a component unmounted and would throw on the null ref. Giving the property a
 * value lets that measurement run as the no-op it is here.
 */
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return Number(this.dataset.testHeight ?? 0);
  },
});

/*
 * For the same reason a computed width is empty. A form whose labels share the widest one's width (`label-width="auto"`)
 * measures each label that way and reports every width it cannot keep (an empty one, or 0); here every label is 64px.
 */
const computedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
  const style = computedStyle(element, pseudo);
  return new Proxy(style, {
    get(target, key) {
      if (key === "width" && !target.width) return "64px";
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}) as typeof window.getComputedStyle;
