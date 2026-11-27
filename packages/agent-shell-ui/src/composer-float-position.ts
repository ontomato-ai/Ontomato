/** Where a floating composer part stands inside its page area, measured inward from the lower right. */
export interface ComposerFloatPosition {
  right: number;
  bottom: number;
}

export interface ComposerFloatSize {
  width: number;
  height: number;
}

const FAB_KEY = "ontomato.shell.composerFabPosition";
const COMPOSER_KEY = "ontomato.shell.composerPosition";

/** Keeps a position inside the page area; when either is too small the part still starts at the area's edge. */
export function clampComposerFloatPosition(
  position: ComposerFloatPosition,
  area: ComposerFloatSize,
  part: ComposerFloatSize,
): ComposerFloatPosition {
  const right = Math.max(0, Math.min(position.right, Math.max(0, area.width - part.width)));
  const bottom = Math.max(0, Math.min(position.bottom, Math.max(0, area.height - part.height)));
  return { right, bottom };
}

/** Dragging right or down moves the part nearer to those edges, so both inward distances decrease. */
export function draggedComposerFloatPosition(
  start: ComposerFloatPosition,
  dx: number,
  dy: number,
  area: ComposerFloatSize,
  part: ComposerFloatSize,
): ComposerFloatPosition {
  return clampComposerFloatPosition({ right: start.right - dx, bottom: start.bottom - dy }, area, part);
}

function readPosition(key: string, storage: Pick<Storage, "getItem">): ComposerFloatPosition | null {
  try {
    const raw = storage.getItem(key);
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

function writePosition(key: string, position: ComposerFloatPosition, storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(key, JSON.stringify(position));
  } catch {
    // Remembering the place is a convenience only.
  }
}

/** Reads the folded button's place in this browser; anything unreadable or malformed only means it uses its corner. */
export function readComposerFabPosition(storage: Pick<Storage, "getItem"> = localStorage): ComposerFloatPosition | null {
  return readPosition(FAB_KEY, storage);
}

/** Remembers the folded button's place in this browser, beside the composer's folded choice. */
export function writeComposerFabPosition(position: ComposerFloatPosition, storage: Pick<Storage, "setItem"> = localStorage): void {
  writePosition(FAB_KEY, position, storage);
}

/** Reads the expanded floating composer's own remembered place, separate from the folded button's. */
export function readComposerPosition(storage: Pick<Storage, "getItem"> = localStorage): ComposerFloatPosition | null {
  return readPosition(COMPOSER_KEY, storage);
}

/** Remembers the expanded floating composer's own place, separate from the folded button's. */
export function writeComposerPosition(position: ComposerFloatPosition, storage: Pick<Storage, "setItem"> = localStorage): void {
  writePosition(COMPOSER_KEY, position, storage);
}

/**
 * The page area the folded button may cross. The two floating docks are absolute strips of zero height when folded;
 * the first relatively positioned ancestor above them is the page area in both hosts (the entry unit at a page's own
 * address, the page pane beside the conversation).
 */
export function composerFloatArea(element: HTMLElement): HTMLElement {
  let node = element.parentElement;
  while (node) {
    if (getComputedStyle(node).position === "relative") return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

/** Measures the part's present distances from a reference area's lower right, including the stylesheet's default. */
export function currentComposerFloatPosition(part: HTMLElement, area: HTMLElement): ComposerFloatPosition {
  const partBox = part.getBoundingClientRect();
  const areaBox = area.getBoundingClientRect();
  return { right: areaBox.right - partBox.right, bottom: areaBox.bottom - partBox.bottom };
}

export const composerFabPositionKey = FAB_KEY;
export const composerPositionKey = COMPOSER_KEY;
