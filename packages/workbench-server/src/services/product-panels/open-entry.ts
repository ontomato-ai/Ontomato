import {
  isApplicationPanelUse, type ApplicationEntryResolutionQuery, type ApplicationOpenResponse, type ApplicationPanelUse,
} from "@ontomato/contracts/product-panels";
import { findCurrentProducts, type CurrentProductRow } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import { type DefinitionKind, definitionKinds, definitionVisibleInRange } from "./access";
import { personalEntry } from "./application-use";
import type { CurrentProjectionBatchItem } from "./current";
import { openViaJava, type PanelReadRanges, type PanelReadVisibility } from "./java-panel-reads";
import { bundledPanelProjectionIds, panelDefinition, projectionDefinition } from "./render-definitions";

const openVisibility: readonly PanelReadVisibility[] = [
  { kind: "PANEL", verbs: ["USE"] }, { kind: "PROJECTION", verbs: ["USE"] }, { kind: "COMPONENT", verbs: ["USE"] },
];

function definitionUsable(kind: DefinitionKind, row: CurrentProductRow, visibility: PanelReadRanges, domainId: string) {
  return definitionVisibleInRange(row, visibility[definitionKinds[kind]].USE, domainId);
}

export async function openApplicationDefinitions(query: ApplicationEntryResolutionQuery, credentials: AssistantCredentials) {
  const { entry: admitted, viewer: owner, visibility } = await openViaJava(query, openVisibility, credentials);
  const { domainId } = owner;
  const entry = await personalEntry(admitted, owner);
  const use = isApplicationPanelUse(entry.use) ? entry.use : null;
  const contentId = use?.panelId;
  const { framePanelId } = entry;
  const ids = [framePanelId, contentId, ...entry.menu.panelUses.flatMap(use => isApplicationPanelUse(use) ? [use.panelId] : [])]
    .filter((id): id is string => id !== undefined);
  const panels = await findCurrentProducts(domainId, "panel", ids);
  const panelUses = entry.menu.panelUses.filter(use => {
    if (!isApplicationPanelUse(use)) return true;
    const row = panels.get(use.panelId);
    return row !== undefined && definitionUsable("panel", row, visibility, domainId);
  });

  const readPanel = (id: string | undefined, inputs?: ApplicationPanelUse["inputs"]) => {
    if (id === undefined) return null;
    const row = panels.get(id);
    if (!row) throw new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE");
    if (!definitionUsable("panel", row, visibility, domainId))
      throw new HttpError(403, "The panel cannot be used", "OBJECT_FORBIDDEN");
    const panel = panelDefinition(row, false);
    return { panel, projectionIds: bundledPanelProjectionIds(panel, inputs) };
  };
  const frame = readPanel(framePanelId);
  const content = readPanel(contentId, use?.inputs);
  const projectionIds = [...new Set([...(frame?.projectionIds ?? []), ...(content?.projectionIds ?? [])])];
  const rows = await findCurrentProducts(domainId, "projection", projectionIds);
  const projections = new Map<string, CurrentProjectionBatchItem>(projectionIds.map(id => {
    const row = rows.get(id);
    if (!row) return [id, { ok: false, error: new HttpError(404, "Current product definition not found", "PRODUCT_UNAVAILABLE") }];
    if (!definitionUsable("projection", row, visibility, domainId))
      return [id, { ok: false, error: new HttpError(403, "The projection cannot be used", "OBJECT_FORBIDDEN") }];
    return [id, { ok: true, projection: projectionDefinition(row, false) }];
  }));
  let pageSkillContext: ApplicationOpenResponse["pageSkillContext"];
  if (use && content) {
    pageSkillContext = {
      applicationId: entry.applicationId, entryKey: use.id, pageKey: use.pageKey,
      useId: use.id, panelId: use.panelId, path: use.path, memberPath: [],
    };
  }
  const componentUsable = (row: CurrentProductRow) => definitionUsable("component", row, visibility, domainId);
  return {
    owner,
    entry: { ...entry, pageSkillContext, menu: { ...entry.menu, panelUses } },
    frame, content, projections, componentUsable,
  };
}
