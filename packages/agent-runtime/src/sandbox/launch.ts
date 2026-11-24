import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { HarnessDirectories, HarnessProcess, HarnessSandbox } from "../adapters/contract";
import { prepareSandboxMounts, sandboxPolicyDirectory, type SandboxFiles } from "./mounts";
import { callbackPort, gatewayPort, openSandboxRelays, type SandboxEndpoints } from "./network";

export interface SessionSandboxOptions extends SandboxFiles {
  readonly uid: number;
  readonly endpoints: SandboxEndpoints;
  readonly processCount: number;
  readonly fileBytes: number;
}

export interface OpenSessionSandbox extends HarnessSandbox {
  readonly directories: HarnessDirectories;
  readonly hostWorkspace: string;
  readonly hostState: string;
  readonly gatewayBaseUrl: string;
  readonly callbackBaseUrl: string;
  stop(): Promise<void>;
}

export async function openSessionSandbox(options: SessionSandboxOptions): Promise<OpenSessionSandbox> {
  if (!Number.isInteger(options.uid) || options.uid <= 0) {
    throw new Error("A Linux sandbox requires a non-root session UID");
  }
  const temporary = await mkdtemp(join(tmpdir(), "ontomato-jail-"));
  const socketDirectory = join(temporary, "relay");
  const config = join(temporary, "nsjail.cfg");
  const prepared = await (async () => {
    try {
      await mkdir(socketDirectory, { mode: 0o755 });
      await chmod(socketDirectory, 0o755);
      const prepared = await prepareSandboxMounts(options, temporary, options.uid);
      await writeFile(config, prepared.mounts.join("\n") + "\n");
      const closeRelays = await openSandboxRelays(socketDirectory, options.uid, options.endpoints);
      return { ...prepared, closeRelays };
    } catch (error) {
      await rm(temporary, { recursive: true });
      throw error;
    }
  })();

  let process: HarnessProcess | undefined;
  let stopped: Promise<void> | undefined;
  return {
    directories: prepared.directories,
    hostWorkspace: prepared.workspace,
    hostState: prepared.state,
    gatewayBaseUrl: `http://127.0.0.1:${gatewayPort}/v1`,
    callbackBaseUrl: `http://127.0.0.1:${callbackPort}`,
    spawn(command, args, env) {
      if (process || stopped) throw new Error("Open one engine per session sandbox");
      const environment = join(temporary, "engine-env");
      writeFileSync(environment, JSON.stringify({
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        HOME: "/workspace/home",
        TMPDIR: "/workspace/tmp",
        PYTHONDONTWRITEBYTECODE: "1",
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
        ...env,
      }), { mode: 0o600 });
      const fd = openSync(environment, "r");
      unlinkSync(environment);

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn("/usr/local/sbin/nsjail", [
          "--config", config, "--mode", "o", "--quiet",
          "--disable_clone_newuser", "--disable_clone_newcgroup",
          "--user", String(options.uid), "--group", String(options.uid),
          "--cwd", "/workspace", "--proc_path", "/proc",
          "--time_limit", "0", "--rlimit_cpu", "inf", "--rlimit_as", "inf",
          "--rlimit_fsize", "inf", "--rlimit_nproc", String(options.processCount),
          "--pass_fd", "3", "--pass_fd", "4", "--pass_fd", "5", "--",
          "/usr/local/bin/python3", "-IS", `${sandboxPolicyDirectory}/engine.py`,
          String(gatewayPort), String(callbackPort), String(options.fileBytes), command, ...args,
        ], { env: {}, stdio: ["pipe", "pipe", "pipe", "pipe", fd, "pipe"] }) as ChildProcessWithoutNullStreams;
      } finally {
        closeSync(fd);
      }
      const [, , , channel, , exitStatus] = Array.from(child.stdio);
      let engineExit = "";
      exitStatus!.on("data", chunk => { engineExit += chunk.toString(); });
      let killed = false;
      process = {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        channel: channel as Duplex,
        exited: new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", code => {
            const status = engineExit ? Number(engineExit) : code;
            resolve(killed || (status !== null && status < 0) ? null : status);
          });
        }),
        kill() {
          // nsjail handles SIGTERM by killing and reaping PID 1 of this namespace.
          killed = child.kill("SIGTERM");
        },
      };
      return process;
    },
    stop() {
      return stopped ??= (async () => {
        process?.kill();
        try {
          await process?.exited;
        } finally {
          await prepared.closeRelays();
          await rm(temporary, { recursive: true });
        }
      })();
    },
  };
}

export async function destroySessionSandbox(sessionDirectory: string, sandbox?: OpenSessionSandbox) {
  await sandbox?.stop();
  await rm(sessionDirectory, { recursive: true, force: true });
}
