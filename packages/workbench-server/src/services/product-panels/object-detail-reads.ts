import { saveObjectDetailValuesSchema } from "@ontomato/contracts/object-detail";
import type { PanelFormDescription, PanelFormValues, PanelRecord } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE, PRODUCT_PANEL, SAVE_OBJECT_DETAIL_PANEL } from "@ontomato/contracts/platform-object-types";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type { ProductOwner } from "../product-governance/grants";
import { currentDefinition, usableCurrentIds } from "./access";
import { decideObject } from "../product-governance/authorization";
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

export function createObjectDetailReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const text = (key: string) => objectDetailText(viewer.locale, key);

  return {
    async record(className: string): Promise<PanelRecord> {
      const [id, canConfigure] = await Promise.all([
        findObjectDetailPanelId(owner.domainId, className), canConfigureObjectDetail(owner, viewer),
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
        } else if (!(await decideObject({ ...currentDefinition("panel", detail.panel, owner.domainId), verb: "USE" }, viewer)).allowed) {
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
        findObjectDetailPanelId(owner.domainId, className), canConfigureObjectDetail(owner, viewer),
      ]);
      const panelId = canConfigure || id === null || (await usableCurrentIds("panel", owner.domainId, [id], viewer)).has(id) ? id : null;
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
