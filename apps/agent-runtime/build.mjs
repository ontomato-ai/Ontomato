// The runtime is a public-only application, including in enterprise deliveries.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStamp,
  docker,
  imageBuildArgs,
  imageCacheArgs,
  imageLabels,
  inspectImage,
  parseOptions,
  readRevision,
  sampleSources,
  stagingDirectory,
} from "../../scripts/build-support.mjs";
import {
  collectMetadataContext,
  copyWorkspace,
} from "../../scripts/pnpm-workspace-context.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const app = {
  repoRoot: root,
  publicRoot: root,
  component: "ontomato-agent-runtime",
  workspaceId: "ontomato",
  appImporter: "apps/agent-runtime",
  sources: [{ id: "ontomato", root }],
};
// Pinned external artifacts are listed, with their SHA256, only in these lock files.
const PINNED_LOCKS = ["apps/agent-runtime/codex/sources.lock", "apps/agent-runtime/sandbox-policy/sources.lock"];
// PINNED_DOWNLOADS_DIR is an optional host directory of prefetched artifacts named by
// SHA256. Only the ones the lock files pin enter the context; the directory always
// exists so the Dockerfile can mount it, and an empty one means "download".
function stagePinnedDownloads(destination) {
  mkdirSync(destination, { recursive: true });
  const source = process.env.PINNED_DOWNLOADS_DIR;
  if (!source) return;
  for (const lock of PINNED_LOCKS)
    for (const [sha] of readFileSync(join(root, lock), "utf8").matchAll(/\b[0-9a-f]{64}\b/g))
      if (existsSync(join(source, sha))) cpSync(join(source, sha), join(destination, sha));
}
export function prepareContext(destination) {
  const record = collectMetadataContext({ ...app, destination });
  copyWorkspace(app, destination, record);
  cpSync(
    join(root, "packages/agent-runtime/requirements-py310.txt"),
    join(destination, "requirements-py310.txt"),
  );
  cpSync(join(root, "apps/agent-runtime/sandbox-policy"), join(destination, "sandbox-policy"), { recursive: true });
  cpSync(join(root, "apps/agent-runtime/codex"), join(destination, "codex"), { recursive: true });
  stagePinnedDownloads(join(destination, "downloads"));
  record.yamlProvider = "@ontomato/agent-runtime";
  record.web = false;
  writeFileSync(join(destination, "inputs.json"), JSON.stringify(record));
  for (const file of [
    "apt-install.sh",
    "github-download.sh",
    "build-support.mjs",
    "third_party_notices.py",
    ...[
      "install-runtime",
      "runtime-layout",
      "production-graph",
      "stage-app",
    ].map((name) => `workbench/${name}.mjs`),
  ]) {
    mkdirSync(dirname(join(destination, "tools", file)), { recursive: true });
    cpSync(join(root, "scripts", file), join(destination, "tools", file));
  }
  for (const file of ["LICENSE", "NOTICE"])
    cpSync(join(root, file), join(destination, file));
}
export function build(args) {
  if (args.includes("--help")) {
    console.log("Use node apps/agent-runtime/build.mjs --arch amd64|arm64");
    return;
  }
  const arch = parseOptions(args, { "--arch": "value" })["--arch"];
  const version = readRevision(readFileSync(join(root, "pom.xml"), "utf8"));
  const sources = sampleSources(app);
  const stamp = buildStamp(version, root, sources);
  const context = stagingDirectory(root, "agent-runtime", arch, "image");
  prepareContext(context);
  const tag = `${app.component}:${stamp}-${arch}`;
  docker([
    "buildx",
    "build",
    "--provenance=false",
    "--platform",
    `linux/${arch}`,
    ...imageCacheArgs(),
    ...imageBuildArgs(),
    "--load",
    ...imageLabels(app.component, version, stamp),
    "--label",
    `org.opencontainers.image.revision=${sources[0].revision}`,
    "--label",
    "org.opencontainers.image.source=https://github.com/ontomato-ai/Ontomato",
    "-t",
    tag,
    "-t",
    `${app.component}:deploy-${arch}`,
    "-f",
    join(root, "apps/agent-runtime/Dockerfile"),
    context,
  ]);
  const image = inspectImage(tag, `linux/${arch}`);
  if (
    image?.Os !== "linux" ||
    image.Architecture !== arch ||
    image.Config?.Labels?.["io.ontomato.component"] !== app.component ||
    image.Config?.Labels?.["org.opencontainers.image.version"] !== version
  )
    throw new Error(`Built image identity mismatch: ${tag}`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    build(process.argv.slice(2));
  } catch (error) {
    console.error(`[build] ${error.message}`);
    process.exitCode = 1;
  }
}
