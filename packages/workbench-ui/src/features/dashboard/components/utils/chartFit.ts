/*
 * A card's chart, old or metric-referencing, is laid out for the size it is drawn at: the card and its zoom draw the
 * same option at very different sizes, and the room for labels follows that size, not the data.
 */

import { computed, ref } from "vue";

type Option = Record<string, any>;
type DrawnSize = { width: number; height: number };

/** Sizes move in steps of this many pixels, so dragging a card's edge lays its chart out again a step at a time. */
const STEP = 20;

/**
 * The size a chart is drawn at, from EChart's resize event, in steps of STEP pixels: a resize within the same step
 * changes nothing, so the chart is not drawn again. Unknown until the chart's first layout.
 */
export function useDrawnSize() {
  const width = ref(0);
  const height = ref(0);
  return {
    size: computed(() => (width.value ? { width: width.value, height: height.value } : undefined)),
    track(size: DrawnSize) {
      width.value = Math.round(size.width / STEP) * STEP;
      height.value = Math.round(size.height / STEP) * STEP;
    },
  };
}

/**
 * A slanted category label may run to 40% of the chart's width and 60% of its height (half of that is the room it
 * takes below the axis at 30°), never under 64px or over 240px; only a longer name ends in an ellipsis.
 */
function categoryLabelLength({ width, height }: DrawnSize) {
  return Math.round(Math.min(Math.max(Math.min(width * 0.4, height * 0.6), 64), 240));
}

/** Room a pie keeps on each side for a label's line and two short lines of text. */
const PIE_LABEL_ROOM = 110;

/**
 * The share of its own radius a pie keeps at this size: a pie as wide as a narrow card leaves its labels too little
 * room, so it shrinks until each side keeps PIE_LABEL_ROOM, down to half its size.
 */
function pieScale(series: Option, { width, height }: DrawnSize) {
  const outer = [series.radius].flat().at(-1);
  if (typeof outer !== "string" || !outer.endsWith("%")) return 1;
  const radius = (parseFloat(outer) / 100) * (Math.min(width, height) / 2);
  return Math.min(Math.max((width / 2 - PIE_LABEL_ROOM) / radius, 0.5), 1);
}

function scaleRadius(radius: string | string[], scale: number) {
  const scaled = (value: string) => `${(parseFloat(value) * scale).toFixed(1)}%`;
  return Array.isArray(radius) ? radius.map(scaled) : scaled(radius);
}

/** The option laid out for the size it is drawn at; before the first size is known it is drawn as it is. */
export function fitChart(option: Option | null | undefined, size: DrawnSize | undefined) {
  if (!option || !size) return option;
  const next: Option = { ...option };
  if (option.xAxis) {
    const length = categoryLabelLength(size);
    next.xAxis = [option.xAxis].flat().map((axis: Option) =>
      axis.type === "category" && axis.axisLabel?.rotate ? { ...axis, axisLabel: { ...axis.axisLabel, width: length } } : axis
    );
  }
  if (option.series) {
    next.series = [option.series].flat().map((series: Option) => {
      if (series.type !== "pie") return series;
      const scale = pieScale(series, size);
      return scale < 1 ? { ...series, radius: scaleRadius(series.radius, scale) } : series;
    });
  }
  return next;
}
