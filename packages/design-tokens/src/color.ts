/** sRGB hex colour arithmetic used to derive the Element Plus ladders and to audit contrast. */

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`brand colours are 6-digit hex values: ${hex}`);
  const value = match[1];
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16)) as [number, number, number];
}

function toHex(values: readonly number[]) {
  return `#${values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** `color` moved toward `base` by `weight` (0 keeps `color`, 1 gives `base`), the way Element Plus derives its ladders. */
export function mix(color: string, base: string, weight: number) {
  const from = channels(color);
  const to = channels(base);
  return toHex(from.map((value, index) => value * (1 - weight) + to[index] * weight));
}

/** "r, g, b" for Element Plus `--el-color-*-rgb`. */
export function rgbTriplet(color: string) {
  return channels(color).join(", ");
}

/**
 * "r, g, b" of a literal colour as a theme may write it (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`), its
 * alpha left out as Element Plus's triplet leaves it; undefined for any other value.
 */
export function literalRgbTriplet(value: string): string | undefined {
  const literal = value.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(literal)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16)).join(", ");
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/i.exec(literal);
  return rgb ? rgb.slice(1, 4).map(Number).join(", ") : undefined;
}

function luminance(color: string) {
  const [r, g, b] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrastRatio(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
