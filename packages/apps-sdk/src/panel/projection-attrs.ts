import type { Component } from "vue";

/** Declared prop names on a component definition (array or object form). */
export function declaredComponentProps(component: Component): Set<string> {
  const options = component as { props?: readonly string[] | Record<string, unknown> };
  return new Set(Array.isArray(options.props) ? options.props : Object.keys(options.props ?? {}));
}

/**
 * What a panel's template says where it places a member: the listeners it wants on the drawn component. An attribute
 * written on `<Projection>` configures nothing — a member's fixed presentation is its own `config`, and a value that
 * follows the page is one of its inputs (`:inputs`). `class`/`style` size the container the member is drawn in.
 */
export function placementListeners(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([name, value]) => /^on[A-Z]/.test(name) && value !== undefined));
}
