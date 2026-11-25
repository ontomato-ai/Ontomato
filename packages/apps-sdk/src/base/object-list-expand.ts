const INTERACTIVE_ROW_TARGET_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='menuitem']",
  "[contenteditable='true']",
  "[data-row-action]",
].join(", ");

/**
 * Returns true when a click originated from an interactive control nested inside a list row so
 * whole-row expansion (`rowActivation="expand"`) does not accidentally toggle alongside the control.
 */
export function isInteractiveRowClickTarget(
  target: EventTarget | null,
  rowElement: EventTarget | null,
): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target === rowElement) return false;
  const match = target.closest(INTERACTIVE_ROW_TARGET_SELECTOR);
  if (!match) return false;
  if (rowElement instanceof Element) {
    if (match === rowElement) return false;
    if (!rowElement.contains(match)) return false;
  }
  return true;
}

/**
 * Deduplicates and normalizes a raw `expandedKeys` input array while enforcing `rowExpandMode`
 * (`"single"` keeps at most the first valid key; `"multiple"` preserves all unique non-empty keys).
 */
export function normalizeExpandedKeys(
  raw: unknown,
  mode: "single" | "multiple",
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
    if (mode === "single") break;
  }
  return normalized;
}

/** Returns true if any candidate alias for a row is present in the expanded keys set. */
export function matchesRowExpandedKey(
  expandedKeys: ReadonlySet<string>,
  aliases: readonly string[],
): boolean {
  for (const alias of aliases) {
    if (alias && expandedKeys.has(alias)) return true;
  }
  return false;
}

/** Computes the next `expandedKeys` array when collapsing one row (removing all its aliases). */
export function removeExpandedRowAliases(
  current: readonly string[],
  aliases: readonly string[],
): string[] {
  const aliasSet = new Set(aliases);
  return current.filter((key) => !aliasSet.has(key));
}

/** Computes the next `expandedKeys` array when expanding one row under the active expand mode. */
export function addExpandedRowKey(
  current: readonly string[],
  canonicalKey: string,
  aliases: readonly string[],
  mode: "single" | "multiple",
): string[] {
  if (mode === "single") {
    return [canonicalKey];
  }
  const aliasSet = new Set(aliases);
  if (current.some((key) => aliasSet.has(key))) {
    return [...current];
  }
  return [...current, canonicalKey];
}
