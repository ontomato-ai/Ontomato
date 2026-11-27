import { spawn } from "node:child_process";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { startAgentRuntime } from "../../application";
import { workspaceDirectory } from "@ontomato/agent-runtime/workspaces";

const program = fileURLToPath(new URL("../../../../../packages/agent-runtime/src/adapters/pi/import.mjs", import.meta.url));

// CI runs real PI and PG here. The image preflight covers the Linux namespace boundary.
await startAgentRuntime((_store, root) => async ({ scope, sessionDirectory, workspaceId, skills, gatewayUrl, callback }) => {
  const workspace = path.join(sessionDirectory, "workspace");
  const state = path.join(sessionDirectory, "native");
  await Promise.all([mkdir(state, { recursive: true }), ...["outputs", "tmp", "home", "skills"].map(
    name => mkdir(path.join(workspace, name), { recursive: true }),
  )]);
  if (workspaceId)
    await symlink(path.join(workspaceDirectory(root, scope, workspaceId), "tree"), path.join(workspace, "work"))
      .catch(error => { if (error.code !== "EEXIST") throw error; });
  else await mkdir(path.join(workspace, "work"), { recursive: true });

  for (const skill of skills)
    await symlink(skill.directory, path.join(workspace, "skills", skill.name))
      .catch(error => { if (error.code !== "EEXIST") throw error; });

  let kill: (() => void) | undefined;
  let exited: Promise<number | null> | undefined;
  return {
    directories: { workspace, state, skills: skills.map(skill => ({ name: skill.name, directory: skill.directory })) },
    hostWorkspace: workspace,
    hostState: state,
    gatewayBaseUrl: new URL("/v1", gatewayUrl).href,
    callbackBaseUrl: `http://${callback.host}:${callback.port}`,
    spawn(_command, _args, env) {
      const child = spawn(process.execPath, [program], {
        cwd: workspace, env: { PATH: process.env.PATH, TMPDIR: path.join(workspace, "tmp"), ...env },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
      kill = () => { child.kill(); };
      exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, channel: child.stdio[3] as Duplex, kill, exited };
    },
    async stop() { kill?.(); await exited; },
  };
});
