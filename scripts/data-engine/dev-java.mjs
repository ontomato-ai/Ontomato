import { ensureRuntimeCredentials } from "../runtime-credentials.mjs";
// Host Java dev entry for one product's apps/data-engine: stage the resources the app image would
// carry, then run the reactor's spring-boot:run in the foreground. The JVM synchronizes
// product defaults into .dev before Spring starts. PostgreSQL and readiness belong to the full-stack entry.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative } from "node:path";
import { parseEnv } from "node:util";
import { holdForeground } from "../dev-command.mjs";
import { stageResources } from "./build-images.mjs";

// The official Maven wrapper pair shipped by the reactor root.
export function mavenWrapper(root, platform = process.platform) {
  return join(root, platform === "win32" ? "mvnw.cmd" : "mvnw");
}

// A .cmd file is a batch script, not an executable Node can start on its own, and Node would join
// file and arguments into one unescaped string. Windows therefore runs cmd.exe /c with the same
// per-argument escaping npm's cross-spawn applies: quotes and cmd meta characters (spaces included)
// are caret escaped, trailing backslashes are doubled, and the line is passed verbatim so Node
// never re-splits or re-joins a user Maven argument. Non-Windows keeps the direct exec. Whether
// cmd.exe preserves the arguments is covered by the Windows-only fake-wrapper test; the real
// Maven wrapper remains part of Windows integration verification.
//
// Escaping transcribed from cross-spawn 7.0.6 lib/util/escape.js, MIT License,
// Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdArgument(value) {
  const arg = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1");
  return `"${arg}"`.replace(CMD_META, "^$1");
}

export function mavenInvocation(
  wrapper,
  args,
  platform = process.platform,
  comspec = process.env.ComSpec || "cmd.exe",
) {
  if (platform !== "win32") return { command: wrapper, args, verbatim: false };
  const line = [
    wrapper.replace(CMD_META, "^$1"),
    ...args.map(cmdArgument),
  ].join(" ");
  return {
    command: comspec,
    args: ["/d", "/s", "/c", `"${line}"`],
    verbatim: true,
  };
}

export const readDotEnv = parseEnv;

// Process values override the shared root .env. Windows variable names are
// case-insensitive, so an inherited Path and a file PATH are the same variable and only the process
// value survives; POSIX names stay case-sensitive and are merged as before.
export function mergeEnvironment(inherited, vars, platform = process.platform) {
  if (platform !== "win32") return { ...vars, ...inherited };
  const env = {};
  const spellings = new Map();
  for (const [name, value] of [
    ...Object.entries(vars),
    ...Object.entries(inherited),
  ]) {
    const upper = name.toUpperCase();
    if (spellings.has(upper)) delete env[spellings.get(upper)];
    spellings.set(upper, name);
    env[name] = value;
  }
  return env;
}

// Validate local configuration, stage product defaults, then launch Maven.
export function startDevJava(
  { app, appDir, wrapper, profiles },
  userArgs,
  inherited = process.env,
) {
  const lang = inherited.PROMPT_LANG ?? app.promptLang;
  if (!app.supportedPromptLangs.includes(lang))
    throw new Error(
      `PROMPT_LANG must be one of ${app.supportedPromptLangs.join(", ")}`,
    );
  const envFile = join(app.repoRoot, ".env");
  if (!existsSync(envFile))
    throw new Error(
      `Missing ${envFile}: copy the product root .env.example first`,
    );
  const vars = readDotEnv(readFileSync(envFile, "utf8"));

  // The staging directory is rebuilt every time; .dev is only synced into, never cleared.
  const staging = join(app.repoRoot, ".build", "dev", "data-engine");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  stageResources(app, staging, lang);
  mkdirSync(join(appDir, ".dev"), { recursive: true });

  const env = ensureRuntimeCredentials(
    app.repoRoot,
    mergeEnvironment(inherited, vars),
  );
  env.AGENT_RUNTIME_URL ||= "http://127.0.0.1:3001";
  env.ONTOMATO_QUERY_CALLBACK_URL ||=
    env.DATA_QUERY_BASE_URL || "http://127.0.0.1:18087";
  env.ONTOMATO_CONF_DEFAULTS = join(staging, "payload/conf-defaults");
  env.ONTOMATO_APP_SKILLS = join(staging, "payload/skills");
  // Certain VPNs (such as aTrustAgent) set up system SOCKS/HTTP proxies; when the JVM reads them, it hijacks local localhost connections,
  // leading to failure connecting to local PostgreSQL. Explicitly disable the JVM proxy here (placed last to ensure it overrides system-detected proxies).
  const disableProxy = "-DsocksProxyHost= -Dhttp.proxyHost= -Dhttps.proxyHost=";
  env.JAVA_TOOL_OPTIONS = env.JAVA_TOOL_OPTIONS
    ? `${env.JAVA_TOOL_OPTIONS} ${disableProxy}`
    : disableProxy;
  const args = [
    "-B",
    "-ntp",
    "-DskipTests",
    "-pl",
    relative(app.repoRoot, appDir),
    "-am",
    ...profiles.map((profile) => `-P${profile}`),
    "spring-boot:run",
    ...userArgs,
  ];
  const invocation = mavenInvocation(wrapper, args);
  return spawn(invocation.command, invocation.args, {
    cwd: app.repoRoot,
    env,
    stdio: "inherit",
    windowsVerbatimArguments: invocation.verbatim,
  });
}

// Foreground CLI: extra Maven arguments and the wrapper's exit result pass through unchanged.
// Foreground signal handling shares the platform rule with the other development commands.
export function runDevJava(options) {
  let child;
  try {
    child = startDevJava(options, process.argv.slice(2));
  } catch (error) {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const release = holdForeground(child);
  child.once("error", (error) => {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    release();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}
