import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";

/*
 * An application's theme (product-layer standard, parts one and two; design §三 and §六, big main's ruling 2026-11-21):
 * values for the platform's design variables, assigned inside that application's area only. The area is the frame and the
 * content of the application at full page, and the content alone beside a conversation; the platform's rail and account
 * area are outside it. A pop-up layer follows the place that opened it: a pop-up the platform's component library puts
 * at the end of the document takes the values of the area its trigger sits in.
 *
 * Which variables may be assigned and what their values may be is checked where the theme is registered; the host only
 * assigns what it is given, in the reader's mode, and takes it away again.
 */

export type ThemeMode = "light" | "dark";

/** The custom properties a theme assigns in one mode: each name as a CSS custom property, `--` included. */
export function themeProperties(theme: PanelThemeOverrides | null | undefined, mode: ThemeMode): Record<string, string> {
  const values = theme?.[mode] ?? {};
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name.startsWith("--") ? name : `--${name}`, value]));
}

/** The themed areas shown now, by their element: what a pop-up opened inside one of them takes. */
const areas = new Map<HTMLElement, Record<string, string>>();
let observer: MutationObserver | null = null;

function assign(element: HTMLElement, properties: Record<string, string>, previous: Record<string, string> = {}) {
  for (const name of Object.keys(previous)) if (!(name in properties)) element.style.removeProperty(name);
  for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value);
}

/** The themed area a pop-up was opened from, found through the trigger that names the pop-up as what it controls. */
function areaOpening(popup: HTMLElement): Record<string, string> | undefined {
  const id = popup.id;
  if (!id) return undefined;
  const escaped = CSS.escape(id);
  const trigger = document.querySelector<HTMLElement>(`[aria-controls~="${escaped}"], [aria-describedby~="${escaped}"]`);
  if (!trigger) return undefined;
  for (const [area, properties] of areas) if (area.contains(trigger)) return properties;
  return undefined;
}

/** The theme of the area an element sits in, if any. */
function areaOf(element: Element): Record<string, string> | undefined {
  for (const [area, properties] of areas) if (area.contains(element)) return properties;
  return undefined;
}

/** The pop-ups a trigger names as what it controls or is described by. */
function namedBy(trigger: Element): HTMLElement[] {
  const ids = [trigger.getAttribute("aria-controls"), trigger.getAttribute("aria-describedby")]
    .flatMap((value) => value?.split(/\s+/) ?? []).filter(Boolean);
  return ids.flatMap((id) => {
    const found = document.getElementById(id);
    return found ? [found] : [];
  });
}

const LINK_ATTRIBUTES = ["aria-controls", "aria-describedby", "aria-expanded"];

/**
 * Gives every pop-up layer the theme of the area that opened it. A pop-up added at the end of the document takes it when
 * a trigger already names it; a component library that adds the layer first and names it on its trigger only when it
 * opens (a date picker) is followed through that trigger: when a trigger inside an area names a layer, the layer takes
 * the area's theme.
 */
function followPopups() {
  if (observer || typeof MutationObserver !== "function") return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) {
        const properties = areaOf(record.target);
        if (properties) for (const popup of namedBy(record.target)) assign(popup, properties);
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const popups = node.matches("[id]") ? [node, ...node.querySelectorAll<HTMLElement>("[id]")] : [...node.querySelectorAll<HTMLElement>("[id]")];
        for (const popup of popups) {
          const properties = areaOpening(popup);
          if (properties) assign(popup, properties);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: LINK_ATTRIBUTES });
}

/**
 * The panel's own theme with a placement's laid over it, key by key and mode by mode: the order the standard composes
 * them in (platform default, deployment, application, the panel, this placement), for the two layers one element holds.
 */
export function composeThemes(...layers: (PanelThemeOverrides | null | undefined)[]): PanelThemeOverrides {
  const composed: PanelThemeOverrides = {};
  for (const mode of ["light", "dark"] as const) {
    const values = Object.assign({}, ...layers.map((layer) => layer?.[mode] ?? {}));
    if (Object.keys(values).length) composed[mode] = values;
  }
  return composed;
}

/**
 * Assigns a theme to an element outside a component's lifetime (a panel instance the host mounts), following the theme
 * and the reader's mode, until the returned function is called.
 */
export function applyTheme(element: HTMLElement, theme: () => PanelThemeOverrides | null | undefined, mode: () => ThemeMode) {
  let shown: Record<string, string> = {};
  const stop = watch([() => JSON.stringify(theme() ?? null), mode], () => {
    const properties = themeProperties(theme(), mode());
    assign(element, properties, shown);
    shown = properties;
    if (Object.keys(properties).length) {
      areas.set(element, properties);
      followPopups();
    } else areas.delete(element);
  }, { immediate: true });
  return () => {
    stop();
    assign(element, {}, shown);
    areas.delete(element);
  };
}

/**
 * Assigns an application's theme to its area for as long as the caller is mounted: in the reader's current mode, again
 * when the theme or the mode changes, and taken away when the caller unmounts or the theme goes.
 */
export function useAppTheme(area: Ref<HTMLElement | null | undefined>, theme: () => PanelThemeOverrides | null | undefined,
  mode: () => ThemeMode) {
  let shown: { element: HTMLElement; properties: Record<string, string> } | null = null;
  const clear = () => {
    if (!shown) return;
    assign(shown.element, {}, shown.properties);
    areas.delete(shown.element);
    shown = null;
  };
  watch([area, () => JSON.stringify(theme() ?? null), mode], ([element]) => {
    const properties = themeProperties(theme(), mode());
    if (shown && shown.element !== element) clear();
    if (!element || !Object.keys(properties).length) {
      clear();
      return;
    }
    assign(element, properties, shown?.properties);
    shown = { element, properties };
    areas.set(element, properties);
    followPopups();
  }, { immediate: true, flush: "post" });
  onBeforeUnmount(clear);
}

const applicationThemeKey: InjectionKey<Ref<PanelThemeOverrides | null>> = Symbol("platform-application-theme");

/**
 * Called by the frame that draws an application's area (the platform's layout): the application's page writes its
 * entry's theme here, and the frame assigns it on the area it draws — the application's menu and its page, not the rail.
 */
export function provideApplicationTheme(): Readonly<Ref<PanelThemeOverrides | null>> {
  const theme = shallowRef<PanelThemeOverrides | null>(null);
  provide(applicationThemeKey, theme);
  return theme;
}

/** Hands the calling page's application theme to the frame that draws its area, and takes it back when the page goes. */
export function useApplicationTheme(theme: () => PanelThemeOverrides | null | undefined) {
  const target = inject(applicationThemeKey, null);
  if (!target) return;
  watch(() => JSON.stringify(theme() ?? null), () => { target.value = theme() ?? null; }, { immediate: true });
  onBeforeUnmount(() => { target.value = null; });
}
