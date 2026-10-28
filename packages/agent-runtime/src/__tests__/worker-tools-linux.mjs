// Run in a disposable Linux environment with Node 24, Python and the installed PI closure.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, chown } from "node:fs/promises";
import path from "node:path";
if (process.platform !== "linux" || process.getuid() !== 0)
  throw new Error("Linux root fixture required");
const root = await mkdtemp("/tmp/pi-tools-proof-");
await chmod(root, 0o711);
const privateDir = path.join(root, "private");
await mkdir(privateDir, { mode: 0o700 });
await writeFile(path.join(privateDir, "secret"), "supervisor");
async function workspace(name, uid) {
  const dir = path.join(root, name);
  await mkdir(dir, { mode: 0o1770 });
  await chown(dir, 0, uid);
  await chmod(dir, 0o1770);
  for (const name of ["work", "outputs", "tmp", "home"]) {
    await mkdir(path.join(dir, name), { mode: 0o700 });
    await chown(path.join(dir, name), uid, uid);
  }
  await mkdir(path.join(dir, "skills"), { mode: 0o550 });
  await chown(path.join(dir, "skills"), 0, uid);
  await writeFile(path.join(dir, "skills", "SKILL.md"), "immutable", {
    mode: 0o440,
  });
  await chown(path.join(dir, "skills", "SKILL.md"), 0, uid);
  return dir;
}
async function worker(dir, uid) {
  const child = spawn(
    "python3",
    [
      "-I",
      "-S",
      "/fixture/packages/agent-runtime/src/worker-launch.py",
      process.execPath,
      "/fixture/packages/agent-runtime/src/tool-worker.mjs",
    ],
    {
      cwd: dir,
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: path.join(dir, "home"),
        TMPDIR: path.join(dir, "tmp"),
        RUNTIME_PARENT_PID: String(process.pid),
        RUNTIME_LIFETIME_FD: "4",
        RUNTIME_WORKER_UID: String(uid),
        RUNTIME_WORKER_LIMITS: JSON.stringify({
          cpuSeconds: 60,
          memoryBytes: 16 * 1024 ** 3,
          processCount: 64,
          fileBytes: 32 * 1024 ** 2,
          outputBytes: 16 * 1024 ** 2,
          wallTimeMs: 30000,
        }),
        ONTOMATO_TK: "fixture",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  const closed = new Promise((resolve) => child.once("close", resolve));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No worker ready " + log)),
      15000,
    );
    child.once("message", (m) => {
      clearTimeout(timer);
      assert.equal(m.type, "ready");
      resolve();
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(log));
    });
  });
  let seq = 0;
  return {
    call: (name, args) =>
      new Promise((resolve, reject) => {
        const id = String(++seq);
        const receive = (m) => {
          if (m.id === id && m.type !== "update") {
            child.off("message", receive);
            resolve(m);
          }
        };
        child.on("message", receive);
        child.send({ type: "execute", id, name, arguments: args }, (e) => {
          if (e) reject(e);
        });
      }),
    stop: async () => {
      child.stdio[4].destroy();
      await closed;
    },
  };
}
const a = await workspace("a", 20000),
  b = await workspace("b", 20001);
let first, second;
try {
  first = await worker(a, 20000);
  second = await worker(b, 20001);
  assert.equal(
    (await first.call("write", { path: "work/test.txt", content: "old" })).type,
    "result",
  );
  assert.equal(
    (
      await first.call("edit", {
        path: "work/test.txt",
        edits: [{ oldText: "old", newText: "new" }],
      })
    ).type,
    "result",
  );
  assert.equal(
    (await first.call("read", { path: "work/test.txt" })).result.content[0]
      .text,
    "new",
  );
  const bash = await first.call("bash", {
    command: 'id -u; python3 -c "import os; print(os.getuid())"',
  });
  assert.match(bash.result.content[0].text, /20000\n20000/);
  for (const args of [
    { path: privateDir + "/secret" },
    { path: a + "/work/test.txt" },
  ]) {
    const denied = await second.call("read", args);
    assert.ok(denied.type === "error" || denied.result?.isError);
  }
  const immutable = await first.call("write", {
    path: "skills/SKILL.md",
    content: "changed",
  });
  assert.ok(immutable.type === "error" || immutable.result?.isError);
  const rename = await first.call("bash", { command: "mv skills old-skills" });
  assert.ok(rename.type === "error" || rename.result?.isError);
  await first.stop();
  first = await worker(a, 20000);
  assert.equal(
    (await first.call("read", { path: "work/test.txt" })).result.content[0]
      .text,
    "new",
  );
  console.log(
    "PASS PI 1.4 read/write/edit/bash under isolated Linux UID; read-only skills and cross-session denial; same-UID file continuity",
  );
} finally {
  await first?.stop();
  await second?.stop();
}
