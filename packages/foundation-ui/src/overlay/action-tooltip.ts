/** Timing and spacing for short labels on icon-only controls. */
export const actionTooltipProps = {
  trigger: ["hover", "focus"] as ("hover" | "focus")[],
  placement: "bottom",
  offset: 6,
  showAfter: 400,
  hideAfter: 100,
  showArrow: false,
  enterable: false,
} as const;
