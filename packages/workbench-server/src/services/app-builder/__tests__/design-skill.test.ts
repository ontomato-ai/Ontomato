import {expect,it} from 'vitest';
import path from 'node:path';
import {readSkillMarkdown} from '../../../core/skills/manifest';
import {workbenchServerResourceRoot} from '../../../content/resources';
import {APPLICATION_DESIGN_SKILL,APP_BUILDER} from '../definition';

it('loads the default builder design skill through the real standard-package parser',()=>{
  const parsed=readSkillMarkdown(path.join(workbenchServerResourceRoot,'resources/runtime-skills/application-design/SKILL.md'));
  expect(parsed?.manifest.name).toBe(APPLICATION_DESIGN_SKILL.name);
  expect(APP_BUILDER.skills).toContainEqual(APPLICATION_DESIGN_SKILL);
});
