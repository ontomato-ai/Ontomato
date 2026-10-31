import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, lstat } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { RuntimeStore } from "../store";
import { SessionSandbox } from "../sandbox";
import { removeWorkerFiles, type WorkerPolicy } from "../worker";
import type { InstalledSkill } from "../skills";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
// The sandbox drops the worker to a dedicated UID, which needs root; the mode/owner
// assertions below are proof only about the platform they run on.
const isolated = process.platform === "linux" && process.getuid?.() === 0;

describe.skipIf(!database || !isolated)(
  "session sandbox prepares an isolated workspace",
  () => {
    const schema = "sandbox_" + randomUUID().replaceAll("-", "");
    let store: RuntimeStore;
    let workdir = "";
    let sandbox: SessionSandbox;
    let uid = 0;
    const scope = { hostId: "workbench", domainId: "fixture" };
    const sessionId = randomUUID();
    const policy: WorkerPolicy = {
      development: false,
      python: process.env.AGENT_RUNTIME_PYTHON || "python3",
      uidStatePath: "",
    };

    async function create(session: string) {
      const next = new SessionSandbox(store, workdir, policy, scope, session);
      const assigned = await next.prepare(skills);
      return { next, assigned };
    }

    const skills: InstalledSkill[] = [];
    /**
     * A refusal reaches the model two ways: tools that catch their own failure answer with an
     * error result, tools that throw surface a rejected call. Neither may hand over content.
     */
    const refused = async (call: Promise<{ isError?: boolean; content?: unknown }>) => {
      const settled = await call.then(
        (result) => ({ result }),
        () => undefined,
      );
      if (!settled) return;
      expect(settled.result.isError, JSON.stringify(settled.result)).toBe(true);
    };

    beforeAll(async () => {
      workdir = await mkdtemp(path.join(os.tmpdir(), "pi-tools-proof-"));
      policy.uidStatePath = path.join(workdir, "worker-next-uid");
      store = new RuntimeStore(database!, schema);
      await store.initialize();
      await store.createSession(scope, sessionId);
      const source = path.join(workdir, "published-skill");
      await mkdir(source, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(source, "SKILL.md"),
        "---\nname: fixture-skill\ndescription: Sandbox fixture skill.\n---\n\nRead-only fixture.\n",
        { mode: 0o600 },
      );
      skills.push({
        skill: { namespace: { kind: "provider", provider: "workbench" }, name: "fixture-skill" },
        digest: randomBytes(32).toString("hex"),
        description: "Sandbox fixture skill.",
        directory: source,
      });
      const prepared = await create(sessionId);
      sandbox = prepared.next;
      uid = prepared.assigned!;
    }, 60000);

    afterAll(async () => {
      await sandbox?.remove();
      const pool = new pg.Pool({ connectionString: database });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      await store?.close();
      if (workdir) await removeWorkerFiles(workdir);
    }, 60000);

    it("owns the workspace with a dedicated UID and read-only skills", async () => {
      const workspace = sandbox.workspace;
      const owner = (file: string) => lstat(file).then((s) => [s.uid, s.mode & 0o7777]);
      // 01770 keeps other sessions' trees out while letting root reach every workspace.
      expect((await owner(workspace))).toEqual([0, 0o1770]);
      for (const name of ["work", "outputs", "home", "tmp"])
        expect(await owner(path.join(workspace, name)), name).toEqual([uid, 0o700]);
      const installed = path.join(workspace, "skills");
      expect(await owner(installed)).toEqual([0, 0o550]);
      expect(await owner(path.join(installed, "fixture-skill"))).toEqual([0, 0o550]);
      expect(await owner(path.join(installed, "fixture-skill", "SKILL.md"))).toEqual([0, 0o440]);
    }, 30000);

    it("runs the real worker under its own UID and refuses cross-session reads", async () => {
      const other = randomUUID();
      await store.createSession(scope, other);
      const second = await create(other);
      try {
        const first = await started(sandbox, uid);
        const foreign = await started(second.next, second.assigned!);
        await first.call("write", { path: "work/result.txt", content: "owner" });
        expect((await first.call("read", { path: "work/result.txt" })).content).toMatchObject([
          { type: "text", text: "owner" },
        ]);
        // The launcher lowers RLIMIT_NPROC and the UID before the tool runs, so the
        // child cannot recover root even when the script asks for it.
        const whoami = await first.call("bash", {
          command: 'id -u; python3 -c "import os; print(os.getuid())"',
        });
        const output = whoami.content[0];
        expect(output.type).toBe("text");
        expect((output as { text: string }).text.trim().split(/\s+/)).toEqual([
          String(uid),
          String(uid),
        ]);
        for (const target of [
          path.join(sandbox.workspace, "work", "result.txt"),
          path.join(second.next.workspace, "work"),
          "/etc/shadow",
        ]) {
          await refused(foreign.call("read", { path: target }));
        }
        await refused(first.call("write", {
          path: "skills/fixture-skill/SKILL.md",
          content: "tampered",
        }));
        await refused(first.call("bash", { command: "mv skills hidden-skills" }));
        await first.stop();
        await foreign.stop();
      } finally {
        await second.next.remove();
      }
    }, 120000);

    it("keeps a session's files across a worker restart", async () => {
      const first = await started(sandbox, uid);
      await first.call("write", { path: "work/kept.txt", content: "kept" });
      await first.stop();
      const again = await started(sandbox, uid);
      try {
        expect((await again.call("read", { path: "work/kept.txt" })).content).toMatchObject([
          { type: "text", text: "kept" },
        ]);
      } finally {
        await again.stop();
      }
    }, 120000);

    async function started(value: SessionSandbox, workerUid: number) {
      const tools = await value.start(
        workerUid,
        randomUUID(),
        randomUUID(),
        {
          language: "en",
          definition: {
            systemPrompt: "",
            modelRole: "general",
            skills: skills.map((skill) => skill.skill),
            sandbox: {
              limits: codeLimitsSchema.parse({
                memoryBytes: 16 * 1024 ** 3,
                wallTimeMs: 30000,
                cpuSeconds: 60,
                processCount: 64,
                fileBytes: 32 * 1024 ** 2,
                outputBytes: 16 * 1024 ** 2,
              }),
            },
            externalMcp: [],
            compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" },
          },
          input: { role: "user", content: "fixture", timestamp: 1 },
          environment: { values: {}, secrets: {} },
        },
        skills,
      );
      const tool = (name: string) => {
        const found = tools.find((candidate) => candidate.name === name);
        if (!found) throw new Error(`Tool not exposed: ${name}`);
        return found;
      };
      let sequence = 0;
      return {
        call: (name: string, args: unknown) =>
          tool(name).execute(String(++sequence), args as never),
        stop: () => value.stop(),
      };
    }
  },
);
