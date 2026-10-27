import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bundleName,
  buildBundle,
  renderEnvExample,
  stageInstallEntry,
  TEMPLATE_ENTRIES,
} from "./deploy-bundle.mjs";

test("the pack carries the deploy template and no onsite state", () => {
  assert.deepEqual(TEMPLATE_ENTRIES, [
    "docker-compose.yml",
    "initdb.sql",
    "README.md",
    "prepare-env.py",
  ]);
});

test("only the ARCH line changes in .env.example", () => {
  assert.equal(
    renderEnvExample("# c\nARCH=amd64\nPORT=3000\n", "arm64"),
    "# c\nARCH=arm64\nPORT=3000\n",
  );
  assert.throws(() => renderEnvExample("# c\n", "arm64"), /exactly one ARCH=/);
  assert.throws(
    () => renderEnvExample("ARCH=amd64\nARCH=amd64\n", "arm64"),
    /exactly one ARCH=/,
  );
});

test("the pack name carries product, version, local time and architecture", () => {
  assert.equal(
    bundleName("ontomato", "4.0.0-dev", "arm64", new Date("2026-09-28T07:22:24Z")),
    "ontomato-4.0.0-dev-20260928-152224-arm64",
  );
});

test("the whole entry directory stages at the pack root and its shell entries stay executable", () => {
  const installDir = mkdtempSync(join(tmpdir(), "install-entry-"));
  const staging = mkdtempSync(join(tmpdir(), "install-staging-"));
  mkdirSync(join(installDir, "scripts"), { recursive: true });
  writeFileSync(join(installDir, "install.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(installDir, "scripts", "image-artifacts.py"), "# helper\n");
  writeFileSync(join(installDir, "scripts", "check-services.py"), "# checker\n");
  mkdirSync(join(installDir, "maintenance-scripts"));
  writeFileSync(join(installDir, "rebuild-vectors.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(installDir, "maintenance-scripts", "rebuild_worker.py"), "# worker\n");
  stageInstallEntry(installDir, staging);
  assert.equal(readFileSync(join(staging, "maintenance-scripts", "rebuild_worker.py"), "utf8"), "# worker\n");
  assert.equal(statSync(join(staging, "rebuild-vectors.sh")).mode & 0o777, 0o755);
  assert.equal(readFileSync(join(staging, "install.sh"), "utf8"), "#!/usr/bin/env bash\n");
  assert.equal(readFileSync(join(staging, "scripts", "image-artifacts.py"), "utf8"), "# helper\n");
  assert.equal(readFileSync(join(staging, "scripts", "check-services.py"), "utf8"), "# checker\n");
  assert.equal(statSync(join(staging, "install.sh")).mode & 0o777, 0o755);
});

test("a missing assembled install file fails loudly", () => {
  const installDir = mkdtempSync(join(tmpdir(), "install-entry-"));
  const staging = mkdtempSync(join(tmpdir(), "install-staging-"));
  assert.throws(() => stageInstallEntry(installDir, staging), /Install entry missing/);
});

test("an application export records its source without carrying the executor", () => {
  const root = mkdtempSync(join(tmpdir(), "application-export-"));
  const previous = process.cwd();
  const path = process.env.PATH;
  try {
    for (const name of ["bin", "deploy", "tools"]) mkdirSync(join(root, name));
    for (const name of TEMPLATE_ENTRIES) writeFileSync(join(root, "deploy", name), "application");
    writeFileSync(join(root, "deploy/.env.example"), "ARCH=amd64\n");
    writeFileSync(join(root, "tools/mirror.py"), "fixture");
    const python = join(root, "bin/python3");
    writeFileSync(python, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);\n`
      + `if(a.includes('resolve')) console.log(JSON.stringify(['a','b','c','d','e']));\n`
      + `if(a.includes('export')) {const p=a[a.indexOf('--output')+1];fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/delivery.json',JSON.stringify({version:'4.1.4',files:{}}));}\n`);
    chmodSync(python, 0o755);
    process.chdir(root);
    process.env.PATH = `${join(root, "bin")}:${path}`;
    let checked = false;
    const output = buildBundle({ "--arch": "amd64", "--version": "4.1.4", "--tool-bundle": join(root, "tools"),
      "--state": join(root, "state"), "--application-only": true, "--source-version": "4.1.0" }, {
      name: "test", deployDir: join(root, "deploy"), images: ["a", "b", "c", "d", "e"],
      validateImages(images) { assert.deepEqual(images, ["a", "b", "c", "d", "e"]); checked = true; },
    });
    assert.equal(checked, true);
    assert.equal(JSON.parse(readFileSync(join(output, "package/delivery.json"), "utf8")).source, "4.1.0");
    assert.equal(existsSync(join(output, "offline")), false);
    assert.equal(existsSync(`${output}.tar`), false);
    assert.equal(readFileSync(join(output, "docker-compose.yml"), "utf8"), "application");
  } finally {
    process.chdir(previous);
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});
