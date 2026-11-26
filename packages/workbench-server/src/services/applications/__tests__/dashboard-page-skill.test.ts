import {expect,it} from "vitest";
import {fileURLToPath} from "node:url";
import {SkillScanner} from "../../../core/skills/discovery/scanner";
import {workbenchApplications} from "../builtins";
it("wires the dashboards application to its builtin panel and keeps the headless CLI skill public",async()=>{
  const app=workbenchApplications.find(entry=>entry.id==="dashboards");
  expect(app?.framePanelId).toBe("builtin-product-platform-frame");
  expect(app?.declaration.panelUses).toEqual([expect.objectContaining({
    id:"dashboards-main",
    pageKey:"dashboards",
    panelId:"builtin-product-dashboards",
    path:"/dashboards",
  })]);
  const skills=await new SkillScanner(fileURLToPath(new URL("../../../../skills",import.meta.url)),true).scan();
  expect(skills.find(skill=>skill.id==="dashboard-pages")).toMatchObject({id:"dashboard-pages",isPublic:true});
});
