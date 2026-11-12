/** Keep floating menus inside the viewport without overriding Popper's positioning. */
export const dropdownBoundaryOptions = {
  modifiers: [
    { name: 'preventOverflow', options: { padding: 12, rootBoundary: 'viewport' } },
    { name: 'flip', options: { padding: 12, rootBoundary: 'viewport' } },
  ],
};
