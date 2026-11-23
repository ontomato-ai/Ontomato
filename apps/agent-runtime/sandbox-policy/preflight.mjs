import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { chown, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { destroySessionSandbox, openSessionSandbox } from "/app/packages/agent-runtime/src/sandbox/launch.ts";

const caps = BigInt("0x" + (await readFile("/proc/self/status", "utf8")).match(/^CapEff:\s+(\w+)/m)[1]);
for (const [name, bit] of [["SYS_ADMIN", 21n], ["NET_ADMIN", 12n]]) {
  assert.ok(caps & (1n << bit), `Docker capability/seccomp: missing effective CAP_${name}`);
}

const work = await mkdtemp(join(tmpdir(), "ontomato-preflight-"));
const session = join(work, "session");
const other = join(work, "other-session");
const project = join(work, "project");
const skill = join(work, "selected");
const skillOutside = join(work, "unselected");
const servers = [];
let sandbox;
let otherSandbox;
async function endpoint(message, host = "127.0.0.1") {
  const server = createServer((_request, response) => response.end(message)).listen(0, host);
  servers.push(server);
  await once(server, "listening");
  return { host, port: server.address().port };
}

const namespaceMembers = async (namespace, uid) => {
  const { stdout } = await promisify(execFile)("/usr/local/bin/python3", ["-ISc", `
import glob, os, sys
for filename in glob.glob("/proc/[0-9]*/ns/net"):
    try:
        if os.readlink(filename) == sys.argv[1]:
            print(filename)
    except (FileNotFoundError, PermissionError):
        pass
`, namespace], { uid, gid: uid });
  return stdout.trim().split("\n").filter(Boolean);
};

try {
  for (const directory of [session, other, project, skill, skillOutside]) await mkdir(directory, {mode: 0o755});
  await writeFile(join(skill, "SKILL.md"), "selected", { mode: 0o444 });
  await writeFile(join(skillOutside, "SKILL.md"), "unselected", { mode: 0o444 });
  const gateway = await endpoint("gateway");
  const callback = await endpoint("callback");
  const extra = await endpoint("another service", "0.0.0.0");
  const outerAddress = Object.values(networkInterfaces()).flat().find(info => info.family === "IPv4" && !info.internal)?.address ?? "172.31.255.254";
  const options = { uid: 20001, endpoints: { gateway, callback }, processCount: 512, fileBytes: 33554432 };
  const open = (sessionDirectory, files) => openSessionSandbox({ ...options, sessionDirectory, ...files });
  // The two jails use the same UID and the same relay ports without sharing a PID or network namespace.
  otherSandbox = await open(other, { skills: [] });
  const otherProcess = otherSandbox.spawn("/bin/sleep", ["120"], {});
  let otherDiagnostic = "";
  otherProcess.stderr.on("data", chunk => { otherDiagnostic += chunk; });
  await chown(project, options.uid, options.uid);
  sandbox = await open(session, { projectTree: project, skills: [{ name: "selected", directory: skill }] });
  const probe = sandbox.spawn("/usr/local/bin/python3", ["-IS", "/usr/local/lib/ontomato-sandbox/probe.py"], {
    PROBE: [
      options.uid, sandbox.gatewayBaseUrl, sandbox.callbackBaseUrl,
      `127.0.0.1:${extra.port}`, `${outerAddress}:${extra.port}`,
      `${outerAddress}:5432`, "1.1.1.1:443",
    ].join(" "),
  });
  let diagnostic = "";
  probe.stderr.on("data", chunk => { diagnostic += chunk; });
  const lines = createInterface({ input: probe.stdout });
  const controller = new AbortController();
  const namespace = await Promise.race([
    (async () => {
      for await (const line of lines) {
        console.log(line);
        if (line.startsWith("namespace: ")) return line.slice("namespace: ".length);
      }
      const exit = await probe.exited;
      const layer = /network bridge:|net::|net\.cc|lo.*(?:RTM|failed)|socket\(/i.test(diagnostic)
        ? "network bridge"
        : /mount|pivot_root/i.test(diagnostic) ? "mounts" : "Docker capability/seccomp";
      throw new Error(`${layer}: sandbox exited ${exit}\n${diagnostic}`);
    })(),
    delay(15000, undefined, { signal: controller.signal }).then(() => {
      throw new Error(`sandbox startup timed out\n${diagnostic}`);
    }),
  ]).finally(() => controller.abort());
  assert.ok((await namespaceMembers(namespace, options.uid)).length >= 4, "expected engine, bridges and detached descendant");
  await sandbox.stop();
  assert.deepEqual(await namespaceMembers(namespace, options.uid), [], "detached processes kept the network namespace alive");
  const otherExit = await Promise.race([otherProcess.exited, delay(10, "alive")]);
  assert.equal(otherExit, "alive", `same-UID session stopped: ${otherDiagnostic}`);
  assert.equal(await readFile(join(session, "native/probe"), "utf8"), "writable");
  await destroySessionSandbox(session, sandbox);
  assert.ok(!(await readdir(work)).includes("session"));
  assert.equal(await readFile(join(project, "probe"), "utf8"), "writable");
  assert.ok((await readdir(work)).includes("other-session"));
  console.log("teardown: PID tree and network namespace gone; same-UID session and shared project retained");
} finally {
  await sandbox?.stop();
  await otherSandbox?.stop();
  for (const server of servers) server.closeAllConnections();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await rm(work, { recursive: true });
}
