/** Where the folded floating composer's round button stands inside its page area, measured inward from the lower right. */
export interface ComposerFabPosition {
  right: number;
  bottom: number;
}

export interface ComposerFabSize {
  width: number;
  height: number;
}

const KEY = "ontomato.shell.composerFabPosition";

/** Keeps a position inside the page area; when either is too small the button still starts at the area's edge. */
export function clampComposerFabPosition(
  position: ComposerFabPosition,
  area: ComposerFabSize,
  button: ComposerFabSize,
): ComposerFabPosition {
  const right = Math.max(0, Math.min(position.right, Math.max(0, area.width - button.width)));
  const bottom = Math.max(0, Math.min(position.bottom, Math.max(0, area.height - button.height)));
  return { right, bottom };
}

/** Dragging right or down moves the button nearer to those edges, so both inward distances decrease. */
export function draggedComposerFabPosition(
  start: ComposerFabPosition,
  dx: number,
  dy: number,
  area: ComposerFabSize,
  button: ComposerFabSize,
): ComposerFabPosition {
  return clampComposerFabPosition({ right: start.right - dx, bottom: start.bottom - dy }, area, button);
}

/** Reads the position this browser remembers; anything unreadable or malformed only means the button uses its corner. */
export function readComposerFabPosition(storage: Pick<Storage, "getItem"> = localStorage): ComposerFabPosition | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { right, bottom } = parsed as Record<string, unknown>;
    if (typeof right !== "number" || typeof bottom !== "number" || !Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    if (right < 0 || bottom < 0) return null;
    return { right, bottom };
  } catch {
    return null;
  }
}

/** Remembers the position in this browser, beside the composer's folded choice; storage is only a convenience. */
export function writeComposerFabPosition(position: ComposerFabPosition, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(position));
  } catch {
    // Remembering the button's place is a convenience only.
  }
}

/**
 * The page area the button may cross. The two floating docks are absolute strips of zero height when folded; the first
 * relatively positioned ancestor above them is the page area in both hosts (the entry unit at a page's own address, the
 * page pane beside the conversation).
 */
export function composerFabArea(element: HTMLElement): HTMLElement {
  let node = element.parentElement;
  while (node) {
    if (getComputedStyle(node).position === "relative") return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

/** Measures the button's present distances from the page area's lower right, including the stylesheet's default. */
export function currentComposerFabPosition(button: HTMLElement, area: HTMLElement): ComposerFabPosition {
  const buttonBox = button.getBoundingClientRect();
  const areaBox = area.getBoundingClientRect();
  return { right: areaBox.right - buttonBox.right, bottom: areaBox.bottom - buttonBox.bottom };
}

export const composerFabPositionKey = KEY;
