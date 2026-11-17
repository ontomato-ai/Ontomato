import {expect,it} from "vitest";
import {fileURLToPath} from "node:url";
import {SkillScanner} from "../../../core/skills/discovery/scanner";
import {workbenchApplications} from "../builtins";
it("publishes the dashboard declaration's skill from the public packages",async()=>{
  const mapping=workbenchApplications.find(app=>app.id==="dashboards")?.declaration.pageSkills?.find(entry=>"access" in entry&&entry.access==="domain-member");
  expect(mapping).toBeDefined();
  const skills=await new SkillScanner(fileURLToPath(new URL("../../../../skills",import.meta.url)),true).scan();
  expect(skills.find(skill=>skill.id===mapping!.skill.name)).toMatchObject({id:"dashboard-pages",isPublic:true});
});
