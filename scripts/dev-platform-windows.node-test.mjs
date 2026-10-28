import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyWindows,
  identifyWindows,
  javaMainClass,
  parseWindowsCommandLine,
  windowsListeningPids,
  windowsPathEquals,
  windowsPathKey,
  windowsProcesses,
  windowsStop,
} from "./dev-platform-windows.mjs";

const NODE = "C:\\nodejs\\node.exe";
const JAVA = "C:\\Java\\bin\\java.exe";
const CTX = {
  root: "C:\\My Repo\\ontomato",
  devRoot: "C:\\My Repo\\ontomato\\apps\\data-engine\\.dev",
  javaEntry: "C:\\My Repo\\ontomato\\apps\\data-engine\\dev.mjs",
  devCommand: "C:\\My Repo\\ontomato\\scripts\\dev-command.mjs",
};
const row = (command, exe = NODE, extra = {}) => ({ pid: 1, ppid: 1, created: "133000000000000000", exe, command, ...extra });
const role = (command, exe) => classifyWindows(row(command, exe), CTX);

test("parseWindowsCommandLine follows the documented quote and backslash rules", () => {
  assert.deepEqual(parseWindowsCommandLine('"C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\dev.mjs" dev'),
    ["C:\\Program Files\\nodejs\\node.exe", "C:\\a b\\dev.mjs", "dev"]);
  // 2n backslashes + quote: n backslashes and toggle quoting; escaping caller must double trailing backslashes.
  assert.deepEqual(parseWindowsCommandLine('"C:\\dir\\\\" x'), ["C:\\dir\\", "x"]);
  // 2n+1 backslashes + quote: n backslashes + literal quote, quoting continues.
  assert.deepEqual(parseWindowsCommandLine('a\\"b'), ['a"b']);
  // Consecutive double quotes inside quoted segments are literal quotes; outside quotes, two quotes just enter and exit quoted segments.
  assert.deepEqual(parseWindowsCommandLine('"a""b" x'), ['a"b', "x"]);
  assert.deepEqual(parseWindowsCommandLine('a""b'), ["ab"]);
  assert.deepEqual(parseWindowsCommandLine("a\tb  c"), ["a", "b", "c"]);
  assert.deepEqual(parseWindowsCommandLine("   "), []);
});

test("windowsPathKey folds case and separators but keeps spaces and path boundaries", () => {
  assert.equal(windowsPathEquals("C:\\My Repo\\apps\\data-engine\\dev.mjs", "c:/my repo/apps/data-engine/dev.mjs"), true);
  assert.equal(windowsPathEquals("C:\\repo\\\\dev.mjs", "C:/repo/dev.mjs"), true);
  assert.equal(windowsPathEquals("C:\\repo-2\\dev.mjs", "C:\\repo\\dev.mjs"), false);
  assert.equal(windowsPathEquals(undefined, "C:\\repo"), false);
  assert.equal(windowsPathKey("C:\\A\\B"), "c:\\a\\b");
});

test("frontend root, java helper and self bind to this checkout's absolute entry", () => {
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" dev`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" web`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" manager`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" unknown`), undefined);
  assert.equal(role(`"${NODE}" "C:\\other\\scripts\\dev-command.mjs" dev`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.javaEntry}"`), "java-helper");
  assert.equal(role(`"${NODE}" "${CTX.devCommand.replace("dev-command", "dev-stack")}" . up`), "self");
  assert.equal(role(`"${NODE}" -e "x=${CTX.devCommand}"`), undefined);
});

test("Java roles use the launcher's main-class position, not any argv mention", () => {
  const classpath = `${CTX.devRoot}\\conf;C:\\deps\\x.jar`;
  const maven = `"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" -cp "C:\\m2\\boot.jar" org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`;
  assert.equal(role(maven, JAVA), "maven");
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), "maven");
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory=C:\\other org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" spring-boot:run`, JAVA), undefined);
  // Launcher/RAGMain appearing in business arguments does not count as main class.
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" -cp x OtherMain org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), undefined);
  const rag = `"${JAVA}" -cp "${classpath}" io.ontomato.dataengine.RAGMain`;
  assert.equal(role(rag, JAVA), "ragmain");
  assert.equal(role(`"${JAVA}" -cp "${classpath}" OtherMain io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -classpath "C:\\other\\conf;C:\\deps\\x.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -cp "${CTX.devRoot}-other\\conf;x.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -cp "${CTX.devRoot}\\conf;x.jar" io.ontomato.dataengine.OtherMain`, JAVA), undefined);
  // -jar form has no main class argument, unknown form not claimed.
  assert.equal(role(`"${JAVA}" -jar "${CTX.devRoot}\\conf\\app.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
});

test("Spring Boot classpath argument files keep Java ownership bound to this checkout", () => {
  const temp = mkdtempSync(join(tmpdir(), "ontomato-classpath-"));
  const file = join(temp, "spring boot.argfile");
  const command = `"${JAVA}" -cp "@${file}" io.ontomato.dataengine.RAGMain`;
  try {
    writeFileSync(file, JSON.stringify(`${CTX.devRoot}\\conf;C:\\deps\\x.jar`) + "\n");
    assert.equal(role(command, JAVA), "ragmain");
    assert.equal(role(command.replace("RAGMain", "OtherMain"), JAVA), undefined);
    writeFileSync(file, JSON.stringify(`${CTX.devRoot}-other\\conf;C:\\deps\\x.jar`));
    assert.equal(role(command, JAVA), undefined);
    writeFileSync(file, '"unterminated');
    assert.equal(role(command, JAVA), undefined);
    writeFileSync(file, JSON.stringify([`${CTX.devRoot}\\conf`]));
    assert.equal(role(command, JAVA), undefined);
    assert.equal(role(`"${JAVA}" -cp @missing.argfile io.ontomato.dataengine.RAGMain`, JAVA), undefined);
    rmSync(file);
    assert.equal(role(command, JAVA), undefined);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("javaMainClass reads the position, skipping option values", () => {
  assert.equal(javaMainClass(["java", "-cp", "a;b", "io.ontomato.dataengine.RAGMain"]), "io.ontomato.dataengine.RAGMain");
  assert.equal(javaMainClass(["java", "-Dk=v", "-Xmx1g", "org.codehaus.plexus.classworlds.launcher.Launcher", "spring-boot:run"]), "org.codehaus.plexus.classworlds.launcher.Launcher");
  assert.equal(javaMainClass(["java", "-classpath", "a", "OtherMain", "io.ontomato.dataengine.RAGMain"]), "OtherMain");
  assert.equal(javaMainClass(["java", "-jar", "app.jar", "io.ontomato.dataengine.RAGMain"]), undefined);
  assert.equal(javaMainClass(["java"]), undefined);
});

test("concurrently, tsx and the two vite entries bind their absolute paths only", () => {
  const workbench = `${CTX.root}\\apps\\workbench`;
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server`), undefined);
  assert.equal(role(`"${NODE}" "C:\\other\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager`), undefined);
  assert.equal(role(`"${NODE}" "${workbench}\\node_modules\\tsx\\dist\\cli.mjs" watch "${workbench}\\src\\index.ts"`), "frontend-root");
  assert.equal(role(`"${NODE}" "${workbench}\\node_modules\\tsx\\dist\\cli.mjs" watch "C:\\other\\src\\index.ts"`), undefined);
  // Actual worker process left behind after watcher exits (--require/--import form of tsx run).
  const worker = `"${NODE}" --require "${workbench}\\node_modules\\tsx\\dist\\preflight.cjs" --import "file:///${workbench}/node_modules/tsx/dist/loader.mjs"`;
  assert.equal(role(`${worker} "${workbench}\\src\\index.ts"`), "frontend-root");
  assert.equal(role(`${worker} "C:\\other\\src\\index.ts"`), undefined);
  assert.equal(role(`"${NODE}" -e "x=${workbench}\\src\\index.ts"`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" --config "${workbench}\\web\\vite.config.ts"`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" --config "C:\\other\\web\\vite.config.ts"`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "${CTX.root}\\apps\\ontology-manager" --port 5174`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "C:\\other\\apps\\ontology-manager" --port 5174`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "${CTX.root}\\apps\\ontology-manager" --port 5175`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vitest\\vitest.mjs" run`), undefined);
});

test("identifyWindows never claims the inspecting process itself", () => {
  const rows = [row(`"${NODE}" "${CTX.root}\\scripts\\dev-stack.mjs" . up`, NODE, { pid: 99, ppid: 1 })];
  assert.deepEqual(identifyWindows(rows, CTX, 99).group, []);
  assert.deepEqual(identifyWindows(rows, CTX, 99).unattributable, []);
});

// Windows-only black-box tests are explicitly skipped on non-Windows and cannot substitute for physical verification.
// Physical machine verification still requires: pnpm dev:up/dev:down/dev:status/dev:logs across the full lifecycle;
// checkouts with spaces and unicode paths; Ctrl-C preserving PG/Java for reuse by the next up;
// different worktrees not stopping each other; PG volume retained;
// and windowsStop cleaning up cmd.exe/concurrently/tsx/vite subtrees after acquiring Process handles.
// Black-box tests only operate on short-lived dummy Node children spawned by this test, never killing outside PIDs.
const WINDOWS_ONLY = process.platform === "win32" ? false : "Requires Windows machine";

function spawnIdle(args = []) {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], { stdio: ["ignore", "ignore", "ignore"] });
}
function snapshotRow(pid) {
  return windowsProcesses().find((entry) => entry.pid === pid);
}
async function waitForRow(pid, present) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (Boolean(snapshotRow(pid)) === present) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`pid ${pid} liveness status did not become ${present}`);
}
function end(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once("close", done);
    child.kill();
  });
}
function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

test("Windows-only: CIM snapshot keeps non-ASCII text and listener ownership", { skip: WINDOWS_ONLY }, async () => {
  const rows = windowsProcesses();
  const self = rows.find((entry) => entry.pid === process.pid);
  assert.ok(self, "Win32_Process should contain current Node process");
  assert.match(self.command, /dev-platform-windows\.node-test\.mjs/);
  assert.equal(identifyWindows(rows, CTX).group.some((entry) => entry.pid === process.pid), false);

  // Arguments containing non-ASCII characters must return from PowerShell to Node intact (OutputEncoding takes effect).
  const unicode = spawnIdle(["tag-ünïcødé-путь"]);
  try {
    await once(unicode, "spawn");
    for (let attempt = 0; attempt < 40 && !(snapshotRow(unicode.pid)?.command ?? "").includes("tag-ünïcødé-путь"); attempt++)
      await new Promise((done) => setTimeout(done, 250));
    assert.match(snapshotRow(unicode.pid).command, /tag-ünïcødé-путь/);
  } finally {
    await end(unicode);
  }

  // Real temporary loopback listener: listening must map to that PID.
  const listener = spawn(
    process.execPath,
    ["-e", "const net=require('node:net');const s=net.createServer(()=>{});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  try {
    const [chunk] = await once(listener.stdout, "data");
    const port = Number(chunk.toString().trim());
    assert.ok(Number.isInteger(port) && port > 0);
    assert.ok(windowsListeningPids(port).includes(listener.pid));
  } finally {
    await end(listener);
  }
  // No listeners returns an empty array, not query failure; pick a freshly freed port without assuming a static free port.
  let empty = [1];
  for (let attempt = 0; attempt < 3 && empty.length; attempt++) empty = windowsListeningPids(await freePort());
  assert.deepEqual(empty, []);
});

test("Windows-only: windowsStop stops the confirmed instance only and preserves bystanders", { skip: WINDOWS_ONLY }, async () => {
  const target = spawnIdle(), stale = spawnIdle(), bystander = spawnIdle();
  try {
    await Promise.all([once(target, "spawn"), once(stale, "spawn"), once(bystander, "spawn")]);
    const targetRow = snapshotRow(target.pid), staleRow = snapshotRow(stale.pid), bystanderRow = snapshotRow(bystander.pid);
    assert.ok(targetRow && staleRow && bystanderRow);
    const result = windowsStop([
      { pid: target.pid, lstart: targetRow.created, command: targetRow.command },          // Correct identity -> stop
      { pid: stale.pid, lstart: "1", command: staleRow.command },                          // Stale identity -> do not kill
      { pid: bystander.pid, lstart: bystanderRow.created, command: "unmatched-command-line" }, // Instance info changed -> report failed
    ]);
    assert.ok(result.stopped.includes(target.pid), JSON.stringify(result));
    assert.ok(result.reused.includes(stale.pid), JSON.stringify(result));
    assert.ok(result.failed.includes(bystander.pid), JSON.stringify(result));
    await waitForRow(target.pid, false);
    assert.ok(snapshotRow(stale.pid), "PID with stale identity should not be stopped");
    assert.ok(snapshotRow(bystander.pid), "Bystander with unmatched command line should not be stopped");
  } finally {
    await Promise.all([end(target), end(stale), end(bystander)]);
  }
});
test("shared runtime belongs to the launching checkout, including its worker", () => {
  const entry = "C:/Public/apps/agent-runtime/src/index.ts";
  const cli = `"${NODE}" C:/Public/node_modules/tsx/dist/cli.mjs watch ${entry} --dev-root "${CTX.root}"`;
  assert.equal(role(cli), "frontend-root");
  assert.equal(role(cli.replace(CTX.root, CTX.root + "-other")), undefined);
  assert.equal(role(cli.replace('watch', '-e')), undefined);
  assert.equal(role(`"${NODE}" --import C:/Public/node_modules/tsx/dist/esm/index.mjs ${entry} --dev-root "${CTX.root}"`), "frontend-root");
});
