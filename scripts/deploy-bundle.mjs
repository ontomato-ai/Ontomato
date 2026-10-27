// Deployment template plus an oc-mirror delivery. Mirror state stays outside the pack.
// Node built-ins and the Docker CLI only; no host shell.
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execute, output, parseOptions } from "./build-support.mjs";

// Only the deploy template goes into the pack. .env, backend_data and
// frontend_data are onsite state and are never packed.
export const TEMPLATE_ENTRIES = ["docker-compose.yml", "initdb.sql", "README.md", "prepare-env.py"];
// The product hands over one directory of assembled onsite entries (install.sh and any
// other entry with its helper scripts); the whole directory lands at the pack root, so a
// new entry needs no change here. Top-level shell entries stay executable whatever the umask.
export function stageInstallEntry(installDir, staging) {
  try {
    readFileSync(join(installDir, "install.sh"));
  } catch {
    throw new Error(`Install entry missing: ${join(installDir, "install.sh")}`);
  }
  cpSync(installDir, staging, { recursive: true });
  for (const name of readdirSync(installDir))
    if (name.endsWith(".sh")) chmodSync(join(staging, name), 0o755);
}

const FLAGS = {
  "--arch": "value", "--version": "value", "--image-tag": "value",
  "--registry": "value", "--agent-runtime-tag": "value", "--state": "value", "--cache-dir": "value",
  "--network": "value", "--insecure-source": "boolean", "--postgres": "value",
  "--tool-bundle": "value", "--source-version": "value", "--application-only": "boolean",
};

// The pack is the only place that rewrites a template file, and only this line.
export function renderEnvExample(text, arch) {
  const lines = text.split("\n");
  if (lines.filter((line) => line.startsWith("ARCH=")).length !== 1)
    throw new Error(".env.example must contain exactly one ARCH= line");
  return lines
    .map((line) => (line.startsWith("ARCH=") ? `ARCH=${arch}` : line))
    .join("\n");
}

const STAMP_OFFSET_MS = 8 * 3600 * 1000;
// UTC+8 local time, same shape as the build stamp: YYYYMMDD-HHMMSS.
export function bundleStamp(now) {
  return new Date(now.getTime() + STAMP_OFFSET_MS)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

export function bundleName(name, version, arch, now) {
  return `${name}-${version}-${bundleStamp(now)}-${arch}`;
}

export function parseBundleOptions(argv) {
  const options = parseOptions(argv, FLAGS);
  for (const name of ["--version", "--image-tag", "--registry", "--state", "--tool-bundle"])
    if (!options[name]) throw new Error(`Required ${name}`);
  return options;
}

// Product entries own their image list and validation; this module only transports and packs it.
export function buildBundle(options, { name, deployDir, installDir, images, validateImages }) {
  const arch = options["--arch"];
  const version = options["--version"];
  const tools = resolve(options["--tool-bundle"]);
  const mirror = join(tools, "mirror.py");
  execute("python3", [mirror, "tools-verify", "--bundle", tools, "--arch", arch]);
  const imageArgs = (refs) => refs.flatMap((ref, i) => [
    ["--workbench", "--data-engine", "--manager", "--agent-runtime", "--postgres"][i], ref,
  ]);
  const resolved = JSON.parse(output("python3", [mirror, "resolve", "--arch", arch, ...imageArgs(images)]));
  validateImages(resolved);
  const base = bundleName(name, version, arch, new Date());
  const bundleRoot = resolve(".build", "bundle");
  const staging = join(bundleRoot, base);
  mkdirSync(staging, { recursive: true });
  // The prepared tool kit is independent of the application export.
  for (const entry of TEMPLATE_ENTRIES)
    cpSync(realpathSync(join(deployDir, entry)), join(staging, entry), { recursive: true });
  if (!options["--application-only"]) {
    cpSync(tools, join(staging, "offline"), { recursive: true });
    if (installDir) stageInstallEntry(installDir, staging);
  }
  writeFileSync(
    join(staging, ".env.example"),
    renderEnvExample(readFileSync(join(deployDir, ".env.example"), "utf8"), arch),
  );
  execute("python3", [
    mirror, "export", "--arch", arch, "--version", version,
    "--state", resolve(options["--state"]), "--output", join(staging, "package"),
    ...(options["--cache-dir"] ? ["--cache-dir", resolve(options["--cache-dir"])] : []),
    ...imageArgs(resolved),
    ...(options["--network"] ? ["--network", options["--network"]] : []),
    ...(options["--insecure-source"] ? ["--insecure-source"] : []),
    ...(process.env.REGISTRY_AUTH_FILE ? ["--authfile", resolve(process.env.REGISTRY_AUTH_FILE)] : []),
  ]);

  if (options["--source-version"]) {
    const path = join(staging, "package/delivery.json");
    const delivery = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, `${JSON.stringify({ ...delivery, source: options["--source-version"] }, null, 2)}\n`);
  }
  if (options["--application-only"]) return staging;
  // Not gzipped: package/mirror_*.tar already holds compressed layers, so gzip barely shrinks it but costs a lot of CPU.
  const archive = `${staging}.tar`;
  rmSync(archive, { force: true });
  execute("tar", ["--no-xattrs", "--exclude=.DS_Store", "--exclude=__pycache__", "--exclude=*.pyc", "-cf", archive, "-C", bundleRoot, base], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  console.log(`BUNDLE_TAR=${archive}`);
  return archive;
}
