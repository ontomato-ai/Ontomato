import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, chmod, chown, readdir, lstat, readFile, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { workspacePathSchema, WORKSPACE_FILE_BYTES, WORKSPACE_TOTAL_BYTES, type WorkspaceFile } from "@ontomato/contracts/workspaces";
import { RuntimeError } from "./errors";
const execute = promisify(execFile);

/** Git metadata stays outside the tool-writable source tree. */
export class WorkspaceGit {
  readonly tree: string;
  readonly repository: string;
  constructor(readonly directory: string) {
    this.tree = path.join(directory, "tree");
    this.repository = path.join(directory, "repository.git");
  }
  async git(...args: string[]) {
    return (await execute("git", ["--git-dir", this.repository, "--work-tree", this.tree,
      "-c", "safe.directory=*", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
      "-c", "user.name=Ontomato", "-c", "user.email=workspace@ontomato.local", ...args], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      encoding: "buffer", maxBuffer: WORKSPACE_TOTAL_BYTES * 2,
    })).stdout;
  }
  async initialize() {
    await mkdir(this.tree, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o711);
    await this.git("init", "--initial-branch=main");
    await chmod(this.repository, 0o700);
    await this.git("commit", "--allow-empty", "-m", "Initialize workspace");
  }
  async head() { return (await this.git("rev-parse", "HEAD")).toString().trim(); }
  async commit(message: string) {
    await this.files();
    await this.git("add", "-A");
    if ((await this.git("diff", "--cached", "--name-only", "-z")).length)
      await this.git("commit", "-m", message);
    return this.head();
  }
  async resolve(commit: string) {
    await this.git("merge-base", "--is-ancestor", commit, "HEAD");
    return commit;
  }
  async files() {
    const result: { path: string; size: number }[] = [];
    let total = 0;
    const visit = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const name = path.relative(this.tree, file).split(path.sep).join("/");
        workspacePathSchema.parse(name);
        if (entry.isDirectory()) await visit(file);
        else {
          const stat = await lstat(file);
          total += stat.size;
          this.limit(stat.size, total);
          result.push({ path: name, size: stat.size });
        }
      }
    };
    await visit(this.tree);
    return result;
  }
  private limit(size: number, total: number) {
    if (size > WORKSPACE_FILE_BYTES || total > WORKSPACE_TOTAL_BYTES)
      throw new RuntimeError(413, "SOURCE_TOO_LARGE", "Workspace size limit exceeded");
  }
  async committedFiles(commit: string) {
    await this.resolve(commit);
    return (await this.git("ls-tree", "-r", "-l", "-z", commit)).toString().split("\0").filter(Boolean).map(line => {
      const separator = line.indexOf("\t");
      const metadata = line.slice(0, separator), name = line.slice(separator + 1);
      const [mode, , oid, size] = metadata.trim().split(/\s+/);
      workspacePathSchema.parse(name);
      if (!/^100(644|755)$/.test(mode)) throw new RuntimeError(400, "INVALID_SOURCE", "Published files must be regular files");
      return { path: name, oid, size: Number(size) };
    });
  }
  async content(name: string, commit?: string) {
    if (commit) {
      const file = (await this.committedFiles(commit)).find(file => file.path === name);
      if (!file) throw new RuntimeError(404, "NOT_FOUND", "File not found");
      return this.git("cat-file", "blob", file.oid);
    }
    const file = await realpath(path.join(this.tree, name));
    if (!file.startsWith(await realpath(this.tree) + path.sep)) throw new RuntimeError(400, "INVALID_SOURCE", "File escapes workspace");
    const stat = await lstat(file);
    if (!stat.isFile()) throw new RuntimeError(404, "NOT_FOUND", "File not found");
    this.limit(stat.size, stat.size);
    return readFile(file);
  }
  async export(commit: string) {
    const files: WorkspaceFile[] = [];
    let total = 0;
    for (const file of await this.committedFiles(commit)) {
      total += file.size;
      this.limit(file.size, total);
      files.push({ path: file.path, encoding: "base64", content: (await this.git("cat-file", "blob", file.oid)).toString("base64") });
    }
    return { commit, files };
  }
  async replace(files: WorkspaceFile[], uid?: number) {
    let total = 0;
    const names = new Set<string>();
    const decoded = files.map(file => {
      const name = workspacePathSchema.parse(file.path);
      if (names.has(name)) throw new RuntimeError(400, "INVALID_SOURCE", "Duplicate source path");
      names.add(name);
      const bytes = Buffer.from(file.content, file.encoding);
      total += bytes.length;
      this.limit(bytes.length, total);
      return { name, bytes };
    });
    for (const name of names) {
      const parts = name.split("/");
      for (let i = 1; i < parts.length; i++)
        if (names.has(parts.slice(0, i).join("/"))) throw new RuntimeError(400, "INVALID_SOURCE", "File conflicts with directory");
    }
    for (const entry of await readdir(this.tree)) await rm(path.join(this.tree, entry), { recursive: true, force: true });
    for (const file of decoded) {
      const target = path.join(this.tree, file.name);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.bytes, { mode: 0o600 });
    }
    if (uid !== undefined) await this.own(uid);
  }
  async own(uid: number) {
    const visit = async (file: string) => {
      if ((await lstat(file)).isDirectory()) for (const name of await readdir(file)) await visit(path.join(file, name));
      await chown(file, uid, uid);
    };
    await visit(this.tree);
  }
  async history(offset: number, limit: number) {
    const log = await this.git("log", `--skip=${offset}`, `--max-count=${limit}`, "--format=%H%x00%P%x00%aI%x00%s");
    return log.toString().trim().split("\n").filter(Boolean).map(line => {
      const [id, parents, createdAt, message] = line.split("\0");
      return { id, parentIds: parents ? parents.split(" ") : [], createdAt, message };
    });
  }
  async diff(from: string, to: string) {
    await this.resolve(from);
    if (to !== "working") await this.resolve(to);
    return (await this.git("diff", "--no-ext-diff", "--no-textconv", from, ...(to === "working" ? [] : [to]), "--")).toString();
  }
}
