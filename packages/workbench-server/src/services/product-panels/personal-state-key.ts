import type { PanelMemberPath } from "@ontomato/contracts/panel-manifest";

export const panelStateKeyNamespace = "panel-state:";

export type PanelStatePathKey = [
  member: string,
  item?: Exclude<PanelMemberPath[number]["itemKey"], object | undefined> | [className: string, primaryKey: string],
  placementId?: string,
];

export function panelStateDomainPrefix(domainId: string) {
  return `${panelStateKeyNamespace}[${JSON.stringify(domainId)},`;
}

export function panelStateKey(domainId: string, rootId: string, path: PanelStatePathKey[], panelId: string, field: string) {
  return `${panelStateKeyNamespace}${JSON.stringify([domainId, rootId, path, panelId, field])}`;
}
