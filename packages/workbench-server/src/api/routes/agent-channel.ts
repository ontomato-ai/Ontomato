import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import { buildTestAccess } from "../build-test-access";
import { wrap } from "../utils/agent-host";
import { agentChannelService } from "../../services/agent-host/channel";

export const agentChannelRouter = Router();
agentChannelRouter.use(buildTestAccess);
agentChannelRouter.use((req, _res, next) => {
  const actual = Buffer.from(req.header("X-Ontomato-Query-Service-Token") ?? ""), expected = Buffer.from(environment.agentRuntime().queryServiceToken);
  if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return next(new HttpError(403, "Platform service authorization required", "FORBIDDEN"));
  next();
});
for (const action of ["list", "prepare", "settle", "read", "cancel"] as const) {
  agentChannelRouter.post("/" + action, wrap(async (req, res) => {
    const domain = req.header("X-Domain-Id");
    if (!domain) throw new HttpError(400, "Domain is required", "INVALID_REQUEST");
    const result=await agentChannelService[action](req.body,domain,{token:req.header("tk"),apiKey:req.header("X-API-Key")});
    if(Buffer.isBuffer(result)) res.type("application/octet-stream").send(result);
    else res.json(result);
  }));
}
