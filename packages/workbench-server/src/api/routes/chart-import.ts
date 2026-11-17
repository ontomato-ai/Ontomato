import {Router} from "express";
import {chartImportRequestSchema} from "@ontomato/contracts/chart-import";
import {prepareChartImport} from "../../services/charts/import";
import {context} from "../utils/agent-host";
import {asyncHandler} from "../utils/http";
import {HttpError} from "../../utils/errors";
const router:ReturnType<typeof Router>=Router();
router.post("/prepare-import",asyncHandler(async(req,res)=>{
  const input=chartImportRequestSchema.safeParse(req.body);
  if(!input.success)throw new HttpError(400,"Invalid chart import request","INVALID_REQUEST",{issues:input.error.issues});
  const {owner,credentials}=context(req);
  res.json(await prepareChartImport(owner,credentials,input.data));
}));
export default router;
