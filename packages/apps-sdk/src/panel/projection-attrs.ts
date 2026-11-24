import type { Component } from "vue";

export const EXCLUDED_PROJECTION_ATTRS = new Set(["class", "style", "slot", "inputs", "member", "instance"]);

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** Declared prop names on a component definition (array or object form). */
export function declaredComponentProps(component: Component): Set<string> {
  const options = component as { props?: readonly string[] | Record<string, unknown> };
  return new Set(Array.isArray(options.props) ? options.props : Object.keys(options.props ?? {}));
}

/**
 * Splits attributes written on `<Projection>` into event listeners (`on*`) and props declared by the target component,
 * excluding container and placement attributes (`class`, `style`, `slot`, `inputs`, `member`, `instance`).
 */
export function pickProjectionPlacementAttrs(
  attrs: Readonly<Record<string, unknown>>,
  declaredProps: ReadonlySet<string>,
): { listeners: Record<string, unknown>; props: Record<string, unknown> } {
  const listeners: Record<string, unknown> = {};
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (EXCLUDED_PROJECTION_ATTRS.has(name)) continue;
    if (/^on[A-Z]/.test(name)) {
      listeners[name] = value;
      continue;
    }
    if (value === undefined) continue;
    const camel = toCamelCase(name);
    if (declaredProps.has(camel)) {
      props[camel] = value;
    }
  }
  return { listeners, props };
}

/** Forwards placement attributes from `<Projection>` to `PanelMember`, excluding container and placement keys. */
export function forwardDirectProjectionAttrs(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([name]) => !EXCLUDED_PROJECTION_ATTRS.has(name)));
}
