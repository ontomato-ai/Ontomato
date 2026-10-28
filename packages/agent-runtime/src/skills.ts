import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  loadSkills,
  formatSkillsForPrompt,
} from "@earendil-works/pi-coding-agent";
import {
  runtimeRegisterSkillRequestSchema,
  type RuntimeSkillRef,
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
    const meta = front ? parse(front[1]!) : null;
    if (
      !meta ||
      meta.name !== pkg.skill.name ||
      typeof meta.description !== "string" ||
      !meta.description.trim() ||
      meta.description.length > 1024 ||
      Object.keys(meta).some(
        (k) =>
          ![
            "name",
            "description",
            "license",
            "compatibility",
            "metadata",
            "allowed-tools",
          ].includes(k),
      )
    )
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "SKILL.md must use standard fields and matching name/description",
      );
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
        await writeFile(target, file.content, { mode: 0o400 });
      }
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
    await this.store.pool.query(
      `INSERT INTO ${this.store.table("skill_names")} VALUES($1,$2)
      ON CONFLICT(identity) DO UPDATE SET digest=excluded.digest`,
      [canonical(pkg.skill), hash],
    );
    return registered;
  }
  async resolve(
    host: RuntimeHost,
    domain: string,
    ref: RuntimeSkillRef,
  ): Promise<InstalledSkill> {
    this.authorize(host, domain, ref);
    const row = (
      await this.store.pool.query(
        `SELECT s.metadata FROM ${this.store.table("skills")} s
      JOIN ${this.store.table("skill_names")} n USING(identity,digest) WHERE identity=$1`,
        [canonical(ref)],
      )
    ).rows[0];
    if (!row)
      throw new RuntimeError(422, "SKILL_NOT_FOUND", "Skill is not published");
    const registered = row.metadata as RuntimeRegisteredSkill;
    const directory = path.join(
      this.root,
      digest(ref.namespace),
      ref.name,
      registered.digest,
    );
    await readFile(path.join(directory, "SKILL.md"));
    return { ...registered, directory };
  }
}
export function skillCatalog(workspace: string, skills: InstalledSkill[]) {
  const loaded = loadSkills({
    cwd: workspace,
    agentDir: workspace,
    includeDefaults: false,
    skillPaths: skills.map((s) => path.join(workspace, "skills", s.skill.name)),
  });
  if (loaded.skills.length !== skills.length)
    throw new Error("Installed skill catalog is incomplete");
  return formatSkillsForPrompt(loaded.skills);
}
