import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeRegisterSkillRequestSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { InvalidSkillPackageError, parseSkillMarkdown } from "./manifest";

/** Read exact UTF-8 source once; never replace undecodable bytes or omit links. */
export async function readSkillPackage(root: string, skill: RuntimeSkillRef) {
  const files: { path: string; content: string }[] = [];
  const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + "/");
      else if (entry.isFile()) {
        try {
          files.push({ path: relative, content: decode.decode(await readFile(path.join(directory, entry.name))) });
        } catch (error) {
          throw new InvalidSkillPackageError(`Cannot read UTF-8 skill file ${relative}: ${String(error)}`);
        }
      } else throw new InvalidSkillPackageError("Skill packages must contain regular files, not links");
    }
  }
  await walk(root);
  const request = runtimeRegisterSkillRequestSchema.parse({ skill, files });
  const parsed = parseSkillMarkdown(files.find((file) => file.path === "SKILL.md")!.content);
  if (!parsed || parsed.frontmatter.name !== skill.name)
    throw new InvalidSkillPackageError("SKILL.md must declare the package name");
  return request;
}
