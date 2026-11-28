import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const piDist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const sdk = new URL("bundle/index.js", piDist);
export const {
  SessionManager, createBashToolDefinition, createEditToolDefinition,
  createReadToolDefinition, createWriteToolDefinition,
} = await import(sdk.href);

export const bridge = new Socket({ fd: 3, readable: true, writable: true });
const pending = new Map();
let nextId = 0;
let receiveInit;
const initialized = new Promise(resolve => { receiveInit = resolve; });

export function send(frame) {
  bridge.write(JSON.stringify(frame) + "\n");
}

export function call(method, data) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: "request", id, method, data });
  });
}

createInterface({ input: bridge }).on("line", line => {
  const frame = JSON.parse(line);
  if (frame.type === "init") {
    receiveInit(frame.data);
    return;
  }
  const operation = pending.get(frame.id);
  if (!operation) throw new Error("Unexpected PI bridge reply");
  if (frame.type === "progress") {
    operation.onUpdate(frame.update);
    return;
  }
  pending.delete(frame.id);
  if (frame.type !== "response") throw new Error("Unknown PI bridge frame");
  if (frame.error !== undefined) operation.reject(new Error(frame.error));
  else operation.resolve(frame.data);
});

export function invoke(data, signal, onUpdate) {
  const id = nextId + 1;
  signal.throwIfAborted();
  const result = call("invoke", data);
  pending.get(id).onUpdate = onUpdate;
  const cancel = () => send({ type: "cancel", id });
  signal.addEventListener("abort", cancel, { once: true });
  return result.finally(() => signal.removeEventListener("abort", cancel));
}

function prepareSession(init) {
  const file = join(init.directories.state, "pi.jsonl");
  if (init.engineRef !== null) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const header = JSON.parse(content.split("\n", 1)[0]);
    if (header.type !== "session" || header.id !== init.engineRef) {
      throw new Error("PI native session does not match the requested engine reference");
    }
    const session = SessionManager.open(file);
    const definition = session.getEntries().find(
      entry => entry.type === "custom" && entry.customType === "ontomato.session",
    );
    if (!definition) throw new Error("PI session is missing its tool declarations");
    return { file, definition: definition.data };
  }

  const session = SessionManager.inMemory(init.directories.workspace);
  const definition = { tools: init.tools, engineTools: init.engineTools, system: init.prompt.system };
  session.appendCustomEntry("ontomato.session", definition);
  for (const message of init.previousContext ?? []) session.appendMessage(message);
  // New PI sessions write nothing until the first user or assistant message.
  // Persist the SDK's native entries here so even an unused session can be reopened.
  const lines = [session.getHeader(), ...session.getEntries()];
  writeFileSync(file, lines.map(entry => JSON.stringify(entry) + "\n").join(""), { flag: "wx", mode: 0o600 });
  return { file, definition };
}

export let config;

async function main() {
  const init = await initialized;
  const state = prepareSession(init);
  if (state === null) {
    bridge.end(JSON.stringify({ type: "native_session_missing" }) + "\n");
    return;
  }
  const { file, definition } = state;
  config = { model: init.model, directories: init.directories, definition };
  const home = mkdtempSync(join(tmpdir(), "ontomato-pi-"));
  process.once("exit", () => rmSync(home, { recursive: true }));
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = home;
  writeFileSync(join(home, "settings.json"), JSON.stringify({
    retry: { enabled: false, provider: { maxRetries: 0 } },
    cacheWarming: "off",
    steeringMode: "all",
    followUpMode: "all",
  }));
  const cli = new URL("bundle/cli.js", piDist);
  process.argv = [
    process.execPath, fileURLToPath(cli), "--mode", "rpc", "--session", file,
    "--session-dir", init.directories.state,
    "--provider", "ontomato", "--model", init.model.model,
    "--system-prompt", definition.system,
    "--offline", "--no-approve", "--no-extensions", "-e",
    fileURLToPath(new URL("extension.mjs", import.meta.url)),
    "--no-builtin-tools", "--no-mcp", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files",
    ...init.directories.skills.flatMap(skill => ["--skill", skill.directory]),
  ];
  await import(cli.href);
}

// The extension imports this module to share the private channel. Start PI only at the entry point.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
