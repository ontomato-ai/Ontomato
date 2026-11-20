import {
  OBJECT_DETAIL_INTERNAL_PATH,
  objectDetailClassParamsSchema, objectDetailInternalQuerySchema, objectDetailPanelParamsSchema,
  setObjectDetailRequestSchema,
  type ClearObjectDetailResponse, type ObjectDetailResponse, type ObjectDetailUsedByResponse, type SetObjectDetailResponse,
} from "@ontomato/contracts/object-detail";
import { Router } from "express";
import { requireProductGrant } from "../../services/product-governance/grants";
import {
  classesUsingDetailPanel, locateObjectDetailPanel, requireDetailPanel, resolveObjectDetail,
} from "../../services/product-panels/object-detail";
import { clearObjectDetail, setObjectDetail } from "../../services/product-panels/object-detail-write";
import { platformService } from "../middleware/platform-service";
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
  const { panelId } = setObjectDetailRequestSchema.parse(req.body);
  await setObjectDetail(owner, credentials, className, panelId);
  res.json({ panelId } satisfies SetObjectDetailResponse);
}));

objectDetailsRouter.delete("/:className", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { className } = objectDetailClassParamsSchema.parse(req.params);
  await clearObjectDetail(owner, credentials, className);
  res.json({ panelId: null } satisfies ClearObjectDetailResponse);
}));

export const objectDetailsInternalRouter = Router();
objectDetailsInternalRouter.get(OBJECT_DETAIL_INTERNAL_PATH, platformService, wrap(async (req, res) => {
  const { domainId, className } = objectDetailInternalQuerySchema.parse(req.query);
  const panelId = await locateObjectDetailPanel(domainId, className);
  res.json({ panelId } satisfies ObjectDetailResponse);
}));
