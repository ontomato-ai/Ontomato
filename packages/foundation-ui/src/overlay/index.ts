/** Keep floating menus inside the viewport without overriding Popper's positioning. */
export const dropdownBoundaryOptions = {
  modifiers: [
    { name: 'preventOverflow', options: { padding: 12, rootBoundary: 'viewport' } },
    { name: 'flip', options: { padding: 12, rootBoundary: 'viewport' } },
  ],
};
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
