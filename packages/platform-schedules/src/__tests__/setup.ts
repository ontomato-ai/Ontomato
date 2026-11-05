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
