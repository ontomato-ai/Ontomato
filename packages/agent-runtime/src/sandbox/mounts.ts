import { existsSync, lstatSync } from "node:fs";
import { chmod, chown, lstat, mkdir, readlink, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessDirectories } from "../adapters/contract";

export const sandboxPolicyDirectory = "/usr/local/lib/ontomato-sandbox";
export const sandboxDirectories = {
  workspace: "/workspace",
  state: "/native",
} as const;

export interface SandboxSkill {
  readonly name: string;
  readonly directory: string;
}

export interface SandboxFiles {
  readonly sessionDirectory: string;
  readonly projectTree?: string;
  readonly skills: readonly SandboxSkill[];
}

async function writableDirectory(directory: string, uid: number) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error(`Sandbox directory must be a directory: ${directory}`);
  }
  await chown(directory, uid, uid);
}

export async function prepareSandboxMounts(files: SandboxFiles, temporary: string, uid: number) {
  const workspace = join(files.sessionDirectory, "workspace");
  const state = join(files.sessionDirectory, "native");
  await writableDirectory(workspace, 0);
  await chown(workspace, 0, uid);
  await chmod(workspace, 0o1770);
  await writableDirectory(state, uid);
  for (const name of ["home", "outputs", "tmp"]) await writableDirectory(join(workspace, name), uid);

  // Remove the generated catalog left by the former per-turn worker.
  const copiedSkills = join(workspace, "skills");
  const copied = lstatSync(copiedSkills, { throwIfNoEntry: false });
  if (copied?.isDirectory() && copied.uid === 0 && (copied.mode & 0o777) === 0o550) {
    await rm(copiedSkills, { recursive: true });
  }

  const work = join(workspace, "work");
  // The previous layout linked the project tree on disk. The jail mounts it at the same location.
  if (files.projectTree && lstatSync(work, { throwIfNoEntry: false })?.isSymbolicLink()) {
    if (await readlink(work) !== files.projectTree) {
      throw new Error(`Unexpected project link at ${work}`);
    }
    await unlink(work);
  }
  await writableDirectory(work, files.projectTree ? 0 : uid);

  const system = join(temporary, "etc");
  await mkdir(system, { mode: 0o755 });
  await writeFile(join(system, "passwd"), `session:x:${uid}:${uid}:Session:/workspace/home:/bin/bash\n`);
  await writeFile(join(system, "group"), `session:x:${uid}:\n`);
  await writeFile(join(system, "hosts"), "127.0.0.1 localhost\n::1 localhost\n");
  const directories: HarnessDirectories = {
    ...sandboxDirectories,
    skills: files.skills.map(({ name }) => ({ name, directory: `/skills/${name}` })),
  };

  const bind = (source: string, target = source, writable = false, device = false) =>
    `mount { src: ${JSON.stringify(source)} dst: ${JSON.stringify(target)} is_bind: true rw: ${writable} nosuid: true nodev: ${!device} }`;

  const mounts = [
    ...["/usr", "/bin", "/lib", "/lib64", "/etc/ssl/certs", "/etc/fonts", "/etc/ld.so.cache"]
      .filter(existsSync).map(source => bind(source)),
    ...["/dev/null", "/dev/random", "/dev/urandom"].map(source => bind(source, source, true, true)),
    ...["passwd", "group", "hosts"].map(name => bind(join(system, name), `/etc/${name}`)),
    bind(join(temporary, "relay"), "/relay"),
    bind(workspace, directories.workspace, true),
    bind(state, directories.state, true),
    ...(files.projectTree ? [bind(files.projectTree, "/workspace/work", true)] : []),
    ...files.skills.map(({ directory }, index) => bind(directory, directories.skills[index]!.directory)),
  ];
  return { directories, workspace, state, mounts };
}
