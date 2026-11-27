import { saveObjectDetailValuesSchema } from "@ontomato/contracts/object-detail";
import type { PanelFormDescription, PanelFormValues, PanelRecord } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE, PRODUCT_PANEL, SAVE_OBJECT_DETAIL_PANEL } from "@ontomato/contracts/platform-object-types";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import { tForLocale } from "../../i18n";
import { findCurrentProduct } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type { ProductOwner } from "../product-governance/service-authentication";
import { currentDefinitionAccess, definitionVisibleInRange, type DefinitionVisibilityRange } from "./access";
import { findDetailPanel, findObjectDetailPanelId } from "./object-detail";

export const objectDetailText = (locale: string | undefined, key: string) =>
  tForLocale(locale, `panels.objectDetail.${key}`);

export async function canConfigureObjectDetail(owner: ProductOwner, viewer: AssistantCredentials): Promise<boolean> {
  try {
    await assertManagement(workbenchManagement.objectDetailsChange, owner, viewer);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return false;
    throw error;
  }
}

interface ObjectDetailReadAccess {
  canConfigure(): boolean | Promise<boolean>;
  canUsePanel(panel: Parameters<typeof currentDefinitionAccess>[1][number]): boolean | Promise<boolean>;
}

export function createRegisteredObjectDetailReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, canConfigure: boolean, panelUse: DefinitionVisibilityRange,
) {
  return createObjectDetailReadAdapter(owner, viewer, {
    canConfigure: () => canConfigure,
    canUsePanel: panel => definitionVisibleInRange(panel, panelUse, owner.domainId),
  });
}

export function createObjectDetailReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials,
  access: ObjectDetailReadAccess = {
    canConfigure: () => canConfigureObjectDetail(owner, viewer),
    canUsePanel: async panel => (await currentDefinitionAccess("panel", [panel], owner.domainId, viewer, false)).decisions[0].allowed,
  },
) {
  const text = (key: string) => objectDetailText(viewer.locale, key);

  return {
    async record(className: string): Promise<PanelRecord> {
      const [id, canConfigure] = await Promise.all([
        findObjectDetailPanelId(owner.domainId, className), access.canConfigure(),
      ]);
      let panelStatus = "unconfigured";
      let panelId = "";
      let panelName = "";
      let unavailableReason = "";
      if (id !== null) {
        const detail = await findDetailPanel(owner.domainId, id);
        if (detail.status !== "available") {
          panelStatus = "unavailable";
          unavailableReason = text(detail.status);
          if (canConfigure) panelId = id;
        } else if (!(await access.canUsePanel(detail.panel))) {
          panelStatus = "forbidden";
          unavailableReason = text("forbidden");
          if (canConfigure) panelId = id;
        } else {
          panelStatus = "configured";
          panelId = id;
          panelName = detail.panel.name;
        }
      }
      return {
        className: OBJECT_TYPE, primaryKey: className, label: text("panelName"),
        outputs: { configured: id !== null, panelId, panelStatus, canConfigure },
        fields: { panelId, panelName, status: text(panelStatus), unavailableReason },
        fieldLabels: {
          panelId: text("panelId"), panelName: text("panelName"),
          status: text("status"), unavailableReason: text("unavailableReason"),
        },
      };
    },

    async form(className: string, values?: PanelFormValues): Promise<PanelFormDescription> {
      const [id, canConfigure] = await Promise.all([
        findObjectDetailPanelId(owner.domainId, className), access.canConfigure(),
      ]);
      const mapped = !canConfigure && id !== null ? await findCurrentProduct(owner.domainId, "panel", id) : undefined;
      const panelId = canConfigure || (mapped && await access.canUsePanel(mapped)) ? id : null;
      return {
        fields: [{
          path: "/panelId", label: text("panelName"), help: text("formHelp"), required: false,
          valueSchema: cachedZodToRuntimeJsonSchema(saveObjectDetailValuesSchema.shape.panelId),
          control: { kind: "reference", objectType: PRODUCT_PANEL, multiple: false },
          readOnly: !canConfigure,
          ...(!canConfigure && { readOnlyReason: text("configureForbidden") }),
        }],
        values: { panelId: values && Object.hasOwn(values, "panelId") ? values.panelId : panelId },
        errors: [],
        save: {
          operation: SAVE_OBJECT_DETAIL_PANEL, method: "PUT", path: `/api/object-details/${encodeURIComponent(className)}`,
          bodySchema: cachedZodToRuntimeJsonSchema(saveObjectDetailValuesSchema),
        },
      };
    },
  };
}
