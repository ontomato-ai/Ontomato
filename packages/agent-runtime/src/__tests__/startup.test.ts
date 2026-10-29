import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

it.each(["AGENT_RUNTIME_HOSTS"])(
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
            ONTOMATO_MODEL_RUNTIME_TOKEN: "fixture-runtime-token",
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

it("encodes deployment PostgreSQL credentials without making Compose construct a URI", async () => {
  const { databaseUrl } = await import("../../../../apps/agent-runtime/src/database.js");
  const url = new URL(databaseUrl({
    POSTGRES_HOST: "127.0.0.1", POSTGRES_PORT: "5432",
    POSTGRES_USER: "user%40", POSTGRES_PASSWORD: "pass%:@/ #?",
    AGENT_RUNTIME_DATABASE: "runtime-db",
  }));
  expect(decodeURIComponent(url.username)).toBe("user%40");
  expect(decodeURIComponent(url.password)).toBe("pass%:@/ #?");
  expect(url.pathname).toBe("/runtime-db");
});
