import { z } from "zod";
import { saveObjectDetailValuesSchema } from "@ontomato/contracts/object-detail";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { CLEAR_OBJECT_DETAIL_PANEL, OBJECT_TYPE, SAVE_OBJECT_DETAIL_PANEL } from "@ontomato/contracts/platform-object-types";
import { findObjectDetailPanelId } from "./object-detail";
import { objectDetailText } from "./object-detail-reads";
import { clearObjectDetail, setObjectDetail } from "./object-detail-write";
import type { PanelOperationAvailability, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";
import { readyPayload } from "./registered-data-read";

const targetSchema = panelFormTargetSchema.options[0].extend({ objectType: z.literal(OBJECT_TYPE) });
const saveInput = panelFormSaveInputSchema.omit({ revision: true }).extend({ values: saveObjectDetailValuesSchema }).strict();
const resultSchema = z.object({}).strict();

function success(className: string): SinglePanelOperationOutcome {
  return {
    kind: "success", data: {},
    affected: { objects: [{ objectType: OBJECT_TYPE, primaryKey: className }], objectTypes: [OBJECT_TYPE] },
  };
}

/** Clearing needs the reader's right to configure object details and a configured panel to clear. */
const clearAvailability: PanelOperationAvailability<boolean, boolean> = {
  shared: {
    reads: [{ call: { type: OBJECT_TYPE, name: "detailPanel", parameters: {} } }],
    facts: ([result]) => z.boolean().parse(readyPayload(result!).payload),
  },
  local: (targets, { owner }, canConfigure) => Promise.all(targets.map(async target =>
    canConfigure && await findObjectDetailPanelId(owner.domainId, targetSchema.parse(target).primaryKey) !== null)),
  refuse: ({ shared: canConfigure, facts: configured, locale }) => {
    if (!canConfigure) return { reason: objectDetailText(locale, "configureForbidden") };
    if (!configured) return { reason: objectDetailText(locale, "unconfigured") };
  },
};

export const objectDetailOperations = [
  {
    handlerRef: SAVE_OBJECT_DETAIL_PANEL,
    labelKey: "panels.objectDetail.save",
    kind: "form.save",
    binding: { kind: "PlatformOperation", id: SAVE_OBJECT_DETAIL_PANEL },
    effect: "write",
    batch: false,
    targetType: OBJECT_TYPE,
    targetSchema,
    inputSchema: saveInput,
    resultSchema,
    draftInput: input => saveInput.parse(input).values,
    async execute({ executor }, target, input) {
      const { primaryKey } = targetSchema.parse(target);
      const { values: { panelId } } = saveInput.parse(input);
      if (panelId) await setObjectDetail(executor.owner, executor.credentials, primaryKey, panelId);
      else await clearObjectDetail(executor.owner, executor.credentials, primaryKey);
      return success(primaryKey);
    },
  },
  {
    handlerRef: CLEAR_OBJECT_DETAIL_PANEL,
    labelKey: "panels.objectDetail.clear",
    kind: "action",
    binding: { kind: "PlatformOperation", id: CLEAR_OBJECT_DETAIL_PANEL },
    effect: "write",
    batch: false,
    targetType: OBJECT_TYPE,
    targetInput: "objectType",
    async targetLabel(_host, { primaryKey }) { return primaryKey; },
    targetSchema,
    inputSchema: z.object({}).strict(),
    resultSchema,
    availability: clearAvailability,
    async execute({ executor }, target) {
      const { primaryKey } = targetSchema.parse(target);
      await clearObjectDetail(executor.owner, executor.credentials, primaryKey);
      return success(primaryKey);
    },
  },
] as const satisfies readonly PanelWriteServerOperation[];
