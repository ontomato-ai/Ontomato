import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  runtimeRegisterSkillRequestSchema,
  standardSkillFrontmatterSchema,
  type RuntimeSkillRef,
  type RuntimeSkillVersion,
} from "@ontomato/contracts/agent-runtime-skills";
import type { RuntimeRegisteredSkill } from "@ontomato/contracts/agent-runtime";
import { RuntimeStore, canonical, digest } from "./store";
import { RuntimeError } from "./errors";

export interface RuntimeHost {
  id: string;
  token: string;
  providers: string[];
  publishProviders?: string[];
  domainSkills?: boolean;
  /** May read the restricted history projection of other hosts in the same domain. */
  domainHistory?: boolean;
  channelGateway?: boolean;
}
export type InstalledSkill = RuntimeRegisteredSkill & { directory: string };
export class SkillRegistry {
  constructor(
    private store: RuntimeStore,
    private root: string,
  ) {}
  private authorize(
    host: RuntimeHost,
    domain: string | undefined,
    ref: RuntimeSkillRef,
    publishing = false,
  ) {
    const ok =
      ref.namespace.kind === "provider"
        ? (publishing
            ? (host.publishProviders ?? [])
            : host.providers
          ).includes(ref.namespace.provider)
        : host.domainSkills && domain === ref.namespace.domainId;
    if (!ok)
      throw new RuntimeError(
        403,
        "FORBIDDEN",
        "Skill namespace is not authorized",
      );
  }
  async register(
    host: RuntimeHost,
    domain: string | undefined,
    body: unknown,
  ): Promise<RuntimeRegisteredSkill> {
    const pkg = runtimeRegisterSkillRequestSchema.parse(body);
    this.authorize(host, domain, pkg.skill, true);
    const front = pkg.files
      .find((f) => f.path === "SKILL.md")!
      .content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const parsed = standardSkillFrontmatterSchema.safeParse(front ? parse(front[1]!) : null);
    if (!parsed.success || parsed.data.name !== pkg.skill.name)
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "SKILL.md must use standard fields and matching name/description",
      );
    const meta = parsed.data;
    const files = [...pkg.files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const hash = digest(files.map((f) => [f.path, f.content]));
    const directory = path.join(
      this.root,
      digest(pkg.skill.namespace),
      pkg.skill.name,
      hash,
    );
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    const temp = await mkdtemp(directory + "-");
    try {
      for (const file of files) {
        const target = path.join(temp, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, { mode: 0o444 });
      }
      await makeSkillReadable(temp);
      try {
        await rename(temp, directory);
      } catch (e) {
        if (
          !["EEXIST", "ENOTEMPTY"].includes((e as { code?: string }).code ?? "")
        )
          throw e;
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    const registered = {
      skill: pkg.skill,
      digest: hash,
      description: meta.description,
    };
    await this.store.pool.query(
      `INSERT INTO ${this.store.table("skills")} (identity,digest,metadata) VALUES($1,$2,$3)
      ON CONFLICT(identity,digest) DO NOTHING`,
      [canonical(pkg.skill), hash, registered],
    );
    return registered;
  }
  async resolve(
    host: RuntimeHost,
    domain: string,
    version: RuntimeSkillVersion,
  ): Promise<InstalledSkill> {
    const { skill, digest: hash } = version;
    this.authorize(host, domain, skill);
    const row = (
      await this.store.pool.query(
        `SELECT metadata->>'description' AS description FROM ${this.store.table("skills")} WHERE identity=$1 AND digest=$2`,
        [canonical(skill), hash],
      )
    ).rows[0];
    if (!row)
      throw new RuntimeError(422, "SKILL_NOT_FOUND", "Selected skill version is not published");
    const directory = path.join(
      this.root,
      digest(skill.namespace),
      skill.name,
      hash,
    );
    // Stored versions published before bind mounts were readable only by the runtime.
    if (((await lstat(directory)).mode & 0o005) !== 0o005) await makeSkillReadable(directory);
    await readFile(path.join(directory, "SKILL.md"));
    return { ...version, description: row.description, directory };
  }
}
async function makeSkillReadable(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await makeSkillReadable(file);
    else if (entry.isFile()) await chmod(file, 0o444);
    else throw new Error(`Unexpected file in published skill: ${file}`);
  }
  await chmod(directory, 0o755);
}
