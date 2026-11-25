/**
 * Pure helpers for `ObjectList` horizontal tab strip scrolling, active-tab reveal,
 * and inline tab label renaming.
 */

/**
 * Computes the target `scrollLeft` needed to bring an active tab fully into the visible
 * horizontal viewport of a scrolling tab strip. Returns the current `scrollLeft` unchanged
 * when the tab is already fully visible.
 */
export function computeRevealTabScrollLeft(
  scrollLeft: number,
  clientWidth: number,
  tabLeft: number,
  tabWidth: number,
): number {
  if (clientWidth <= 0 || tabWidth <= 0) return Math.max(0, scrollLeft);
  const tabRight = tabLeft + tabWidth;
  if (tabLeft < scrollLeft) {
    return Math.max(0, tabLeft);
  }
  if (tabRight > scrollLeft + clientWidth) {
    return Math.max(0, tabRight - clientWidth);
  }
  return Math.max(0, scrollLeft);
}

/**
 * Computes a smooth single-tab scroll step in pixels for a tab strip arrow click.
 * Prefers the width of the next clipped tab in the scroll direction (plus gap), falling back
 * to the first measured tab width, and finally to a fraction of `clientWidth` when tabs have
 * no measurable layout width.
 */
export function computeTabScrollStep(
  tabBounds: readonly { readonly left: number; readonly width: number }[],
  scrollLeft: number,
  clientWidth: number,
  direction: -1 | 1,
  gap = 4,
): number {
  const positiveBounds = tabBounds.filter((tab) => tab.width > 0);
  if (positiveBounds.length > 0) {
    if (direction === 1) {
      const rightEdge = scrollLeft + clientWidth;
      const nextHidden = positiveBounds.find((tab) => tab.left + tab.width > rightEdge + 1);
      if (nextHidden) {
        return Math.max(1, Math.round(nextHidden.width + gap));
      }
    } else {
      for (let i = positiveBounds.length - 1; i >= 0; i -= 1) {
        const tab = positiveBounds[i]!;
        if (tab.left < scrollLeft - 1) {
          return Math.max(1, Math.round(tab.width + gap));
        }
      }
    }
    return Math.max(1, Math.round(positiveBounds[0]!.width + gap));
  }
  return Math.max(120, Math.floor(clientWidth * 0.5));
}

/**
 * Resolves which input parameter key should receive the edited tab label when committing
 * an inline tab rename through a declared row operation.
 */
export function resolveInlineRenameFieldKey(
  explicitField: string | undefined,
  allowedFields: readonly { readonly name: string; readonly kind: string }[],
): string | null {
  const trimmed = explicitField?.trim();
  if (trimmed) return trimmed;
  if (allowedFields.length === 1) return allowedFields[0]!.name;
  const preferredText = allowedFields.find(
    (field) =>
      (field.kind === "text" || field.kind === "textarea")
      && (field.name === "name" || field.name === "title" || field.name === "label"),
  );
  if (preferredText) return preferredText.name;
  const firstText = allowedFields.find((field) => field.kind === "text" || field.kind === "textarea");
  return firstText?.name ?? null;
}

export type InlineRenameResolution =
  | { readonly kind: "commit"; readonly value: string }
  | { readonly kind: "cancel" };

/**
 * Normalizes an inline rename draft against the original label. Blank or unchanged values
 * resolve as `"cancel"` so no redundant write is dispatched.
 */
export function resolveInlineRenameCommit(draft: string, original: string): InlineRenameResolution {
  const trimmed = draft.trim();
  if (!trimmed || trimmed === original.trim()) {
    return { kind: "cancel" };
  }
  return { kind: "commit", value: trimmed };
}
