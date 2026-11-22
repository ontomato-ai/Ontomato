import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";
import { rootComposites, themeDerivedProperties } from "@ontomato/design-tokens";

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

/**
 * The custom properties a theme assigns in one mode — each name as a CSS custom property, `--` included — and the shades
 * of each colour family it recolours, which the area declares again from its own colours (design tokens' rule).
 */
export function themeProperties(theme: PanelThemeOverrides | null | undefined, mode: ThemeMode): Record<string, string> {
  const values = theme?.[mode] ?? {};
  const assigned = Object.fromEntries(Object.entries(values).map(([name, value]) => [name.startsWith("--") ? name : `--${name}`, value]));
  return { ...themeDerivedProperties(assigned), ...assigned };
}

/**
 * What an area declares for a theme: what it assigns and the shades worked out from it, and every rule the page's
 * stylesheets compose on the root from those (an edition's focus ring of the brand's soft fill), as written, so that it
 * too is worked out from the area's own colours. Read as the page is now, in the mode it is in.
 */
function areaProperties(theme: PanelThemeOverrides | null | undefined, mode: ThemeMode): Record<string, string> {
  const properties = themeProperties(theme, mode);
  return Object.keys(properties).length ? { ...composedFrom(Object.keys(properties)), ...properties } : properties;
}

let compositesFailed = false;

/**
 * The root's rules composed from the recoloured properties. Reading them is a pass over the page's stylesheets; if it
 * fails (a selector it cannot read), the area still takes what the theme assigns, and the failure is named once.
 */
function composedFrom(recoloured: string[]): Record<string, string> {
  try {
    return rootComposites(recoloured);
  } catch (error) {
    if (!compositesFailed) {
      compositesFailed = true;
      console.warn("The application theme is assigned without the page's composed root rules, which could not be read:", error);
    }
    return {};
  }
}

/** The themed areas shown now, by their element: what a pop-up opened inside one of them takes. */
const areas = new Map<HTMLElement, Record<string, string>>();

interface TrackedLayer {
  area: HTMLElement;
  trigger: HTMLElement | null;
  shown: Record<string, string>;
  isOverlay: boolean;
  wasVisible: boolean;
}

/** Teleported poppers and modal overlays currently themed after an area, kept in step when the area changes or closes. */
const trackedLayers = new Map<HTMLElement, TrackedLayer>();
let lastInteraction: { area: HTMLElement; trigger: HTMLElement } | null = null;
let observer: MutationObserver | null = null;
let interactionListenersAttached = false;

function assign(element: HTMLElement, properties: Record<string, string>, previous: Record<string, string> = {}) {
  for (const name of Object.keys(previous)) {
    if (!(name in properties)) element.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(properties)) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
}

/** Whether an element is a teleported modal overlay (dialog or drawer). */
function isOverlay(element: HTMLElement): boolean {
  if (element.classList.contains("el-overlay")) return true;
  return element.parentElement === document.body && element.getAttribute("role") === "dialog";
}

function isOverlayVisible(overlay: HTMLElement): boolean {
  if (!overlay.isConnected || overlay.hidden || overlay.getAttribute("aria-hidden") === "true") return false;
  return overlay.style.display !== "none";
}

/**
 * The deepest themed area an element sits in (including inside an already-tracked teleported layer), and the cascaded
 * theme properties from outermost ancestor area down to that deepest area so nested areas inherit and override cleanly.
 */
function resolveAreaFor(element: Element | null): { area: HTMLElement; properties: Record<string, string> } | undefined {
  const chain: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLElement) {
      if (areas.has(current) && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
      }
      const tracked = trackedLayers.get(current);
      if (tracked && tracked.area.isConnected && !seen.has(tracked.area)) {
        current = tracked.area;
        continue;
      }
    }
    current = current.parentElement;
  }
  if (!chain.length) return undefined;
  const deepest = chain[0]!;
  chain.reverse();
  const properties: Record<string, string> = {};
  for (const area of chain) Object.assign(properties, areas.get(area));
  return { area: deepest, properties };
}

/** The themed area a pop-up was opened from, found through the trigger that names the pop-up as what it controls. */
function areaOpening(popup: HTMLElement): { area: HTMLElement; trigger: HTMLElement; properties: Record<string, string> } | undefined {
  const id = popup.id;
  if (!id) return undefined;
  const escaped = CSS.escape(id);
  const trigger = document.querySelector<HTMLElement>(`[aria-controls~="${escaped}"], [aria-describedby~="${escaped}"]`);
  if (!trigger) return undefined;
  const resolved = resolveAreaFor(trigger);
  return resolved ? { ...resolved, trigger } : undefined;
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

function trackLayer(layer: HTMLElement, area: HTMLElement, properties: Record<string, string>, trigger: HTMLElement | null, overlay: boolean) {
  const previous = trackedLayers.get(layer);
  assign(layer, properties, previous?.shown);
  trackedLayers.set(layer, {
    area,
    trigger: trigger ?? previous?.trigger ?? null,
    shown: { ...properties },
    isOverlay: overlay,
    wasVisible: overlay ? isOverlayVisible(layer) : true,
  });
}

/** Resolve the owning area and trigger for a newly opened dialog/drawer overlay. */
function resolveOverlayOwner(overlay: HTMLElement): { area: HTMLElement; trigger: HTMLElement | null; properties: Record<string, string> } | undefined {
  const linked = areaOpening(overlay);
  if (linked) return linked;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && !overlay.contains(active)) {
    const activeArea = resolveAreaFor(active);
    // If focus is explicitly on a non-themed element (such as the platform rail), do not steal an earlier app's theme.
    return activeArea ? { ...activeArea, trigger: active } : undefined;
  }
  if (lastInteraction && lastInteraction.area.isConnected) {
    const resolved = resolveAreaFor(lastInteraction.area);
    if (resolved) return { ...resolved, trigger: lastInteraction.trigger };
  }
  return undefined;
}

function isFocusableTrigger(element: HTMLElement): boolean {
  if (!element.isConnected || element.hidden) return false;
  if ("disabled" in element && (element as HTMLButtonElement).disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  return element.style.display !== "none";
}

function restoreOverlayFocus(overlay: HTMLElement, entry: TrackedLayer) {
  const active = document.activeElement;
  const focusLost = !active || active === document.body || active === document.documentElement || overlay.contains(active);
  if (!focusLost) return;
  if (entry.trigger && isFocusableTrigger(entry.trigger)) {
    entry.trigger.focus({ preventScroll: true });
    return;
  }
  const container = entry.area.closest<HTMLElement>("[data-panel-instance]")
    ?? entry.area.querySelector<HTMLElement>("[data-panel-instance]")
    ?? entry.area;
  if (!container.isConnected) return;
  if (container.tabIndex < 0 && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
  container.focus({ preventScroll: true });
}

function closeOverlay(overlay: HTMLElement, removed: boolean) {
  const entry = trackedLayers.get(overlay);
  if (!entry || !entry.isOverlay) return;
  const wasVisible = entry.wasVisible;
  if (removed) {
    trackedLayers.delete(overlay);
  } else {
    entry.wasVisible = false;
    assign(overlay, {}, entry.shown);
    entry.shown = {};
  }
  if (wasVisible) restoreOverlayFocus(overlay, entry);
}

/** Keep already-open poppers and overlays in step whenever an area's theme changes or goes away. */
function syncTrackedLayers() {
  for (const [layer, entry] of trackedLayers) {
    if (!layer.isConnected) {
      trackedLayers.delete(layer);
      continue;
    }
    if (entry.isOverlay && !entry.wasVisible) continue;
    const resolved = entry.area.isConnected ? resolveAreaFor(entry.area) : undefined;
    if (resolved) {
      assign(layer, resolved.properties, entry.shown);
      entry.area = resolved.area;
      entry.shown = { ...resolved.properties };
    } else {
      assign(layer, {}, entry.shown);
      trackedLayers.delete(layer);
    }
  }
}

function recordInteraction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target === document.body || target === document.documentElement) return;
  const resolved = resolveAreaFor(target);
  lastInteraction = resolved ? { area: resolved.area, trigger: target } : null;
}

const LINK_ATTRIBUTES = ["aria-controls", "aria-describedby", "aria-expanded"];
const OVERLAY_ATTRIBUTES = ["style", "class", "aria-hidden"];
const OBSERVED_ATTRIBUTES = [...LINK_ATTRIBUTES, ...OVERLAY_ATTRIBUTES];

/**
 * Gives every pop-up layer and modal overlay the theme of the deepest area that opened it, keeps open layers in step
 * when the area's theme or colour mode changes, and restores focus to the trigger or owning container when a modal
 * overlay closes.
 */
function followPopups() {
  if (!interactionListenersAttached && typeof document !== "undefined") {
    interactionListenersAttached = true;
    document.addEventListener("pointerdown", recordInteraction, true);
    document.addEventListener("keydown", recordInteraction, true);
    document.addEventListener("focusin", recordInteraction, true);
  }
  if (observer || typeof MutationObserver !== "function") return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) {
        const attr = record.attributeName ?? "";
        if (LINK_ATTRIBUTES.includes(attr)) {
          const resolved = resolveAreaFor(record.target);
          if (resolved) {
            const trigger = record.target instanceof HTMLElement ? record.target : null;
            for (const popup of namedBy(record.target)) trackLayer(popup, resolved.area, resolved.properties, trigger, isOverlay(popup));
          }
        } else if (OVERLAY_ATTRIBUTES.includes(attr) && record.target instanceof HTMLElement && isOverlay(record.target)) {
          const visible = isOverlayVisible(record.target);
          const existing = trackedLayers.get(record.target);
          if (visible && !existing?.wasVisible) {
            const owner = resolveOverlayOwner(record.target);
            if (owner) trackLayer(record.target, owner.area, owner.properties, owner.trigger, true);
          } else if (!visible && existing?.wasVisible) {
            closeOverlay(record.target, false);
          }
        }
        continue;
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const overlays = isOverlay(node) ? [node] : [...node.querySelectorAll<HTMLElement>(".el-overlay")];
        for (const overlay of overlays) closeOverlay(overlay, true);
        if (trackedLayers.has(node) && !trackedLayers.get(node)!.isOverlay) trackedLayers.delete(node);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const overlays = isOverlay(node) ? [node] : [...node.querySelectorAll<HTMLElement>(".el-overlay")];
        for (const overlay of overlays) {
          if (!isOverlayVisible(overlay)) continue;
          const owner = resolveOverlayOwner(overlay);
          if (owner) trackLayer(overlay, owner.area, owner.properties, owner.trigger, true);
        }
        const popups = node.matches("[id]") ? [node, ...node.querySelectorAll<HTMLElement>("[id]")] : [...node.querySelectorAll<HTMLElement>("[id]")];
        for (const popup of popups) {
          if (isOverlay(popup)) continue;
          const opening = areaOpening(popup);
          if (opening) trackLayer(popup, opening.area, opening.properties, opening.trigger, false);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
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
  // After the page's own updates, so a mode switch has set the root's class the stylesheets read.
  const stop = watch([() => JSON.stringify(theme() ?? null), mode], () => {
    const properties = areaProperties(theme(), mode());
    assign(element, properties, shown);
    shown = properties;
    if (Object.keys(properties).length) {
      areas.set(element, properties);
      followPopups();
    } else areas.delete(element);
    syncTrackedLayers();
  }, { immediate: true, flush: "post" });
  return () => {
    stop();
    assign(element, {}, shown);
    areas.delete(element);
    syncTrackedLayers();
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
    syncTrackedLayers();
  };
  watch([area, () => JSON.stringify(theme() ?? null), mode], ([element]) => {
    const properties = areaProperties(theme(), mode());
    if (shown && shown.element !== element) clear();
    if (!element || !Object.keys(properties).length) {
      clear();
      return;
    }
    assign(element, properties, shown?.properties);
    shown = { element, properties };
    areas.set(element, properties);
    followPopups();
    syncTrackedLayers();
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
