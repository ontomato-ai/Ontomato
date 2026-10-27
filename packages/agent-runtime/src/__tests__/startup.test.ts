import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

it.each(["AGENT_RUNTIME_HOSTS", "AGENT_RUNTIME_MCP_SERVERS"])(
  "does not quote private config when %s contains invalid JSON",
  (name) => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    );
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          createRequire(import.meta.url).resolve("tsx"),
          path.join(root, "apps/agent-runtime/src/index.ts"),
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            AGENT_RUNTIME_HOSTS: JSON.stringify([
              { id: "fixture", token: "fixture-token", providers: [] },
            ]),
            AGENT_RUNTIME_DATABASE_URL:
              "postgresql://unused:unused@127.0.0.1:9/unused",
            AGENT_RUNTIME_MODEL_CONFIG_URL: "http://127.0.0.1:9",
            [name]: "SENSITIVE",
          },
          stdio: "pipe",
          timeout: 10000,
        },
      );
    } catch (error) {
      stderr = String((error as { stderr: Buffer }).stderr);
    }
    expect(stderr).toContain(`Invalid JSON in ${name}`);
    expect(stderr).not.toContain("SENSITIVE");
  },
);
