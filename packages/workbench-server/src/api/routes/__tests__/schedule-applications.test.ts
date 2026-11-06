import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { scheduleApplicationsRouter, scheduleDeclarations, scheduleExecutionStatus } from "../schedule-applications";
import { platformScheduleErrorSchema, platformScheduleFormSchema, platformScheduleExecutionStateSchema } from "@ontomato/contracts/platform-schedules";
import { HttpError } from "../../../utils/errors";

const mocks=vi.hoisted(()=>({form:vi.fn(),validate:vi.fn(),authorize:vi.fn(),start:vi.fn(),status:vi.fn()}));
vi.mock("../../../services/scheduling/applications",()=>({
  scheduleApplicationIds:()=>["fixture"],
  scheduleApplication:()=>({id:"fixture",...mocks}),
  describeScheduleApplication:async()=>({id:"fixture",description:"Application-owned description",available:true,unavailableReason:null,taskCount:0}),
}));
vi.mock("../../../identity/installed",()=>({workbenchIdentity:()=>({requireDomainId:()=>"trusted-domain"})}));
const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>server.close(()=>resolve()));vi.resetAllMocks();vi.unstubAllEnvs();});
async function app() {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN","fixture-platform");
  const router=express();router.use(express.json());
  router.get("/internal/schedule-applications",scheduleDeclarations);
  router.post("/internal/schedule-applications/:appId/runs/status",scheduleExecutionStatus);
  router.use("/api",(req,_res,next)=>{Object.assign(req,{userId:"trusted-user",domainId:"trusted-domain",token:"login",apiKey:"",locale:"en"});next();});
  router.use("/api/platform/schedule-applications",scheduleApplicationsRouter);
  const server=createServer(router);servers.push(server);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address||typeof address==="string")throw new Error("No listener");
  return async(path:string,body?:unknown,token=true)=>fetch(`http://127.0.0.1:${address.port}${path}`,{
    method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",...(token?{"X-Ontomato-Query-Service-Token":"fixture-platform"}:{})},body:body===undefined?undefined:JSON.stringify(body),
  });
}
it("requires the platform credential and derives form ownership from the authenticated request",async()=>{
  const request=await app();
  const denied=await request("/internal/schedule-applications",undefined,false);expect(denied.status).toBe(403);platformScheduleErrorSchema.parse(await denied.json());
  mocks.form.mockResolvedValue({appId:"fixture",formRevision:"v1",fields:[],values:{},summary:[],errors:[],submittable:true});
  const response=await request("/api/platform/schedule-applications/fixture/form",{values:{},changedField:null,taskId:null,timeZone:"UTC"});
  expect(response.status).toBe(200);platformScheduleFormSchema.parse(await response.json());
  expect(mocks.form.mock.calls[0][1].owner).toEqual({userId:"trusted-user",domainId:"trusted-domain"});
  const invalid=await request("/api/platform/schedule-applications/fixture/form",{values:{},changedField:null,taskId:null,timeZone:"UTC",owner:{userId:"forged"}});expect(invalid.status).toBe(400);
});
it("preserves the application validation error and lets service status reads settle without an online Key",async()=>{
  const request=await app();
  mocks.validate.mockRejectedValue(new HttpError(422,"Check values","FIELD_VALIDATION_FAILED",{fields:[{field:"/content/instruction",code:"required",message:"Required"}]}));
  const invalid=await request("/api/platform/schedule-applications/fixture/validate",{content:{instruction:""},formRevision:"v1",timeZone:"UTC"});
  expect(invalid.status).toBe(422);platformScheduleErrorSchema.parse(await invalid.json());
  mocks.status.mockResolvedValue({status:"completed",handle:null,resultLink:null,resultSummary:"Done",result:"Done",spendTime:1,error:null,pause:null,executionDetails:null});
  const response=await request("/internal/schedule-applications/fixture/runs/status",{taskId:randomUUID(),runId:randomUUID(),owner:{userId:"trusted-user",domainId:"trusted-domain"},handle:null});
  expect(response.status).toBe(200);platformScheduleExecutionStateSchema.parse(await response.json());
  expect(mocks.start).not.toHaveBeenCalled();
});
