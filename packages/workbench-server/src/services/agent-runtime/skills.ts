import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { RuntimeClient } from "./client";
/** Publish the exact portable directory; no runtime-specific generated manifest. */
export async function publishSkill(root: string, skill: RuntimeSkillRef) {
  const files: { path: string; content: string }[] = [];
  async function walk(dir: string, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory())
        await walk(path.join(dir, entry.name), relative + "/");
      else if (entry.isFile())
        files.push({
          path: relative,
          content: await readFile(path.join(dir, entry.name), "utf8"),
        });
      else throw new Error("Skill packages must contain regular files");
    }
  }
  await walk(root);
  return new RuntimeClient(undefined).request("/v1/skills", "POST", {
    skill,
    files,
  });
}
