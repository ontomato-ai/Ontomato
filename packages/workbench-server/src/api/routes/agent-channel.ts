import { HttpError } from "../../utils/errors";
import { platformService } from "../middleware/platform-service";
import { Router } from "express";
import { buildTestAccess } from "../build-test-access";
import { wrap } from "../utils/agent-host";
import { agentChannelService } from "../../services/agent-host/channel";

export const agentChannelRouter = Router();
agentChannelRouter.use(buildTestAccess);
agentChannelRouter.use(platformService);
for (const action of ["list", "prepare", "settle", "read", "cancel"] as const) {
  agentChannelRouter.post("/" + action, wrap(async (req, res) => {
    const domain = req.header("X-Domain-Id");
    if (!domain) throw new HttpError(400, "Domain is required", "INVALID_REQUEST");
    const result=await agentChannelService[action](req.body,domain,{token:req.header("tk"),apiKey:req.header("X-API-Key")});
    if(Buffer.isBuffer(result)) res.type("application/octet-stream").send(result);
    else res.json(result);
  }));
}
