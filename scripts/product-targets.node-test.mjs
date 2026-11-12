import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHARED = resolve(dirname(fileURLToPath(import.meta.url)), "product-targets.mk");
let counter = 0;

// A throwaway product root with the real shared rules plus a catch-all fake service
// target that only records its name and ARCH, so no build tool is ever started.
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "product-targets-"));
  writeFileSync(
    join(dir, "Makefile"),
    [
      "ARCH ?= test-arch",
      ".DEFAULT:",
      "\t@printf '%s:%s\\n' \"$@\" \"$(ARCH)\" >> \"$(LOG)\"",
      "\t@test \"$@\" != \"$(FAIL_TARGET)\" || exit 1",
      `include ${SHARED}`,
      "",
    ].join("\n")
  );
  return dir;
}

function run(dir, args, env = {}) {
  const log = join(dir, `calls-${counter++}.log`);
  writeFileSync(log, "");
  const result = spawnSync("make", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LOG: log, ...env },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { status: result.status, calls, stderr: result.stderr };
}

function inWorkspace(fn) {
  const dir = workspace();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("build is the default goal and builds every service once", () => {
  inWorkspace((dir) => {
    const implicit = run(dir, []);
    assert.equal(implicit.status, 0, implicit.stderr);
    assert.ok(implicit.calls.length > 0);
    const names = implicit.calls.map((call) => call.split(":")[0]);
    assert.equal(new Set(names).size, names.length, "a service was built twice");
    const explicit = run(dir, ["build"]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(explicit.calls, implicit.calls);
  });
});

test("a command-line ARCH reaches every aggregate step", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["ARCH=arm64", "build"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.length > 0);
    for (const call of result.calls) assert.ok(call.endsWith(":arm64"), call);
  });
});

test("one aggregate target stays sequential under -j", () => {
  inWorkspace((dir) => {
    const sequential = run(dir, ["build"]);
    assert.equal(sequential.status, 0, sequential.stderr);
    const parallel = run(dir, ["-j4", "build"]);
    assert.equal(parallel.status, 0, parallel.stderr);
    assert.deepEqual(parallel.calls, sequential.calls);
  });
});

test("a failing step stops the aggregate before the later services", () => {
  inWorkspace((dir) => {
    const baseline = run(dir, []);
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.ok(baseline.calls.length >= 2, baseline.calls.join(","));
    const failing = baseline.calls[1].split(":")[0];
    const result = run(dir, ["build"], { FAIL_TARGET: failing });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, baseline.calls.slice(0, 2));
  });
});
