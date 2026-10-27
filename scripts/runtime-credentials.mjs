import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** One local owner for service credentials consumed by both Java and Node. */
export function ensureRuntimeCredentials(root, env) {
  const dir = join(root, ".secrets");
  mkdirSync(dir, { recursive: true });
  for (const [name, keys] of [
    [
      "agent-runtime.env",
      ["AGENT_RUNTIME_SERVICE_TOKEN", "AGENT_RUNTIME_ONTOLOGY_TOKEN"],
    ],
    [
      "ontology-query.env",
      ["ONTOMATO_QUERY_SERVICE_TOKEN", "ONTOMATO_QUERY_SIGNING_KEY"],
    ],
  ]) {
    const file = join(dir, name),
      text = existsSync(file) ? readFileSync(file, "utf8") : "",
      saved = parseEnv(text);
    const missing = keys.filter((key) => !env[key] && !saved[key]);
    if (missing.length) {
      const temporary = file + ".tmp";
      writeFileSync(
        temporary,
        text +
          (text && !text.endsWith("\n") ? "\n" : "") +
          missing
            .map((key) => `${key}=${randomBytes(32).toString("base64url")}\n`)
            .join(""),
        { mode: 0o600, flag: "wx" },
      );
      try {
        renameSync(temporary, file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      if (!text)
        writeFileSync(
          join(dir, "README.md"),
          `\n- ${name}: local service credentials; used by runtime/workbench/ontology assembly; no automatic expiry; never commit.\n`,
          { flag: "a" },
        );
    }
    if (existsSync(file)) {
      chmodSync(file, 0o600);
      const current = parseEnv(readFileSync(file, "utf8"));
      for (const key of keys) env[key] ||= current[key];
    }
    for (const key of keys) if (!env[key]) throw new Error(`Missing ${key}`);
  }
  return env;
}
