import { cpSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStamp, docker, imageCacheArgs, imageLabels, parseOptions, readRevision, sampleSources, stagingDirectory } from "../../scripts/build-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseOptions(process.argv.slice(2), { "--arch": "value" });
const arch = args["--arch"];
const version = readRevision(readFileSync(join(root, "pom.xml"), "utf8"));
const stamp = buildStamp(version, root, sampleSources({ sources: [{ id: "ontomato", root }] }));
const context = stagingDirectory(root, "gateway", arch);
cpSync(join(root, "docker/gateway"), context, { recursive: true });
for (const name of ["LICENSE", "NOTICE"]) cpSync(join(root, name), join(context, name));
docker(["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`, "--load",
  ...imageCacheArgs(), ...imageLabels("ontomato-gateway", version, stamp),
  "-t", `ontomato-gateway:${stamp}-${arch}`, "-t", `ontomato-gateway:deploy-${arch}`, context]);
