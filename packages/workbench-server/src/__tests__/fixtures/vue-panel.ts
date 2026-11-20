/** The contents of a Vue panel whose template places the named projection members. */
export function vuePanelContent(...members: readonly string[]) {
  const projections = members.map(member => `<projection slot="${member}"></projection>`);
  return {
    html: `<div id="app">${projections.join("")}</div>`,
    module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
  };
}
