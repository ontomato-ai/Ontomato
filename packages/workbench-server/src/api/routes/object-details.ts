import {
  objectDetailClassParamsSchema, objectDetailPanelParamsSchema,
  saveObjectDetailValuesSchema,
  type ClearObjectDetailResponse, type ObjectDetailResponse, type ObjectDetailUsedByResponse,
} from "@ontomato/contracts/object-detail";
import { Router } from "express";
import { requireProductGrant } from "../../services/product-governance/grants";
import {
  classesUsingDetailPanel, requireDetailPanel, resolveObjectDetail,
} from "../../services/product-panels/object-detail";
import { clearObjectDetail, setObjectDetail } from "../../services/product-panels/object-detail-write";
import { context, wrap } from "../utils/agent-host";

export const objectDetailsRouter = Router();

objectDetailsRouter.get("/by-panel/:panelId", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { panelId } = objectDetailPanelParamsSchema.parse(req.params);
  await requireProductGrant(panelId, "use", credentials);
  await requireDetailPanel(owner.domainId, panelId);
  const classNames = await classesUsingDetailPanel(owner.domainId, panelId);
  res.json({ classNames } satisfies ObjectDetailUsedByResponse);
}));

objectDetailsRouter.get("/:className", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { className } = objectDetailClassParamsSchema.parse(req.params);
  const resolution = await resolveObjectDetail(owner, credentials, className);
  res.json({ panelId: resolution.kind === "configured" ? resolution.panelId : null } satisfies ObjectDetailResponse);
}));

objectDetailsRouter.put("/:className", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { className } = objectDetailClassParamsSchema.parse(req.params);
  const { panelId } = saveObjectDetailValuesSchema.parse(req.body);
  if (panelId) await setObjectDetail(owner, credentials, className, panelId);
  else await clearObjectDetail(owner, credentials, className);
  res.json({ panelId: panelId || null } satisfies ObjectDetailResponse);
}));

objectDetailsRouter.delete("/:className", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { className } = objectDetailClassParamsSchema.parse(req.params);
  await clearObjectDetail(owner, credentials, className);
  res.json({ panelId: null } satisfies ClearObjectDetailResponse);
}));
