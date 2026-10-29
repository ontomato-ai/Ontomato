import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync, readdirSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import Transport from "winston-transport";
import type { ServiceLogEvent } from "@ontomato/contracts/service-logging";
import { boundText, formatLine, normalizeEvent, quote, parseLine } from "../format";
import { withServiceLogContext, getServiceLogContext, logHeaders } from "../context";
import { normalizeLogQuery } from "../postgres";
import { createServiceLogging } from "../index";

const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/src/service-logging-fixtures.json", import.meta.url), "utf8"));
describe("shared Java/Node service logging contract", () => {
  it("writes identical single-line bytes to Winston stdout and the rotating file", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "service-log-contract-"));
    try {
      const entry = new URL("../index.ts", import.meta.url).href;
      const source = `import { createServiceLogging } from ${JSON.stringify(entry)};
        const logging = createServiceLogging("workbench");
        logging.initialize({ directory: process.env.SERVICE_LOG_TEST_DIRECTORY });
        logging.module("contract").error("failure", new Error("diagnostic\\ntext"));
        await logging.close();`;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, SERVICE_LOG_TEST_DIRECTORY: directory }, encoding: "utf8", timeout: 10000,
      });
      expect(child.status, child.stderr).toBe(0);
      const files = readdirSync(directory).filter((name) => name.endsWith(".log") && lstatSync(path.join(directory, name)).isFile());
      const text = files.sort().map((name) => readFileSync(path.join(directory, name), "utf8")).join("");
      expect(text).toBe(child.stdout);
      expect(text.split("\n")).toHaveLength(2);
      expect(text).toContain(" stack=");
    } finally { rmSync(directory, { recursive: true }); }
  });
  for (const fixture of fixtures.lines) it(fixture.name, () => {
    const event = normalizeEvent(fixture.event as ServiceLogEvent);
    expect(formatLine(event) + "\n").toBe(fixture.line);
    expect(parseLine(formatLine(event))?.message).toBe(event.message);
  });
  for (const fixture of fixtures.truncation) it(fixture.name, () => {
    expect(quote(boundText(fixture.input, fixture.fieldLimitBytes))).toBe(fixture.encodedValue);
  });
  it("keeps attribution across async work without leaking another request", async () => {
    const values = await Promise.all(["request-a", "request-b"].map((correlationId) =>
      withServiceLogContext({ correlationId, userId: correlationId }, async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return [getServiceLogContext().userId, logHeaders()["x-correlation-id"]];
      })));
    expect(values).toEqual([["request-a", "request-a"], ["request-b", "request-b"]]);
    expect(getServiceLogContext()).toEqual({});
  });
  it("does not turn result metadata into a service log payload", () => {
    const logging = createServiceLogging("workbench"), lines: string[] = [];
    logging.logger.clear();
    logging.logger.add(new class extends Transport {
      log(info: any, done: () => void) { lines.push(info[Symbol.for("message")]); done(); }
    }());
    logging.module("query").info("query completed", { result: [{ secretRow: "dataset-content" }], body: "request-body" });
    expect(lines).toHaveLength(1);
    expect(parseLine(lines[0])?.message).toBe("query completed");
    expect(lines[0]).not.toMatch(/dataset-content|request-body/);
    logging.logger.close();
  });
  it("retains an exception's cause while removing unrelated metadata before transports", () => {
    const logging = createServiceLogging("workbench"), records: any[] = [];
    logging.logger.clear();
    logging.logger.add(new class extends Transport {
      log(info: any, done: () => void) { records.push(info); done(); }
    }());
    logging.module("query").error("operation failed", { result: "private rows", error: new Error("outer", { cause: new Error("inner") }) });
    const event = parseLine(records[0][Symbol.for("message")]);
    expect(event?.stack).toContain("Caused by: Error: inner");
    expect(records[0].result).toBeUndefined();
    expect(records[0][Symbol.for("splat")]).toBeUndefined();
    logging.logger.close();
  });
});

it("keeps the cursor window stable and rejects malformed query boundaries", () => {
  const from = "2026-10-28T00:00:00.000Z", to = "2026-10-28T01:00:00.000Z";
  const cursor = Buffer.from(JSON.stringify({ from, to, time: "2026-10-28T00:30:00.000Z", id: "00000000-0000-4000-8000-000000000001" })).toString("base64url");
  expect(normalizeLogQuery({ cursor })).toMatchObject({ from, to });
  for (const invalid of [{ cursor, to: "2026-10-28T02:00:00.000Z" }, { from: to, to: from },
    { limit: [100] }, { limit: "1.5" }, { from: "2026-10-28T00:00:00.0001Z" }, { cursor: "not-json" }]) {
    expect(() => normalizeLogQuery(invalid)).toThrow("Invalid log query");
  }
});
