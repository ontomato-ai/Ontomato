import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { javaBuiltinApplications, prepareBuiltinPanels } from "./workbench/builtin-panels.mjs";

/** Use the selected workspace's members and the same validation as the image stager. */
export async function prepareDevelopmentPanels(root) {
  const members = JSON.parse(execFileSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  })).map(project => ({ name: project.name, absolute: project.path }));
  const server = members.find(member => member.name === "@ontomato/workbench-server");
  if (!server) throw new Error("The selected workspace has no workbench server");
  const sharedRoot = resolve(server.absolute, "../..");
  const sources = [...new Set([root, sharedRoot])].map(root => ({ root }));
  await prepareBuiltinPanels(root, sharedRoot, members, javaBuiltinApplications(sources));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareDevelopmentPanels(resolve(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
