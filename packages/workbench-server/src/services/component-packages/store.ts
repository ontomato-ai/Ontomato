import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPONENT_PACKAGE_INCOMPATIBLE,
  componentPackageResponseSchema, componentPackageUpgradeErrorSchema,
  type ComponentPackageResponse, type ComponentPackageUpgradeError,
} from "@ontomato/contracts/component-packages";
import { runtimeDataDir } from "../../content/layout";
import type { RequestIdentity } from "@ontomato/contracts/identity";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

export type ComponentPackageUpgradeChange = ComponentPackageUpgradeError["details"]["changes"][number];
export type CheckComponentPackageUpgrade = (
  previous: ComponentPackageResponse,
  candidate: ComponentPackageResponse,
  caller: RequestIdentity & { credentials: AssistantCredentials; diagnosticsScope?: "deployment" },
) => Promise<readonly ComponentPackageUpgradeChange[]>;

function packageRoot(name: string) {
  return runtimeDataDir("component-packages", encodeURIComponent(name));
}

export function componentPackageArtifactDirectory(name: string, digest: string) {
  return path.join(packageRoot(name), digest);
}

export async function readComponentPackage(name: string) {
  let text: string;
  try { text = await readFile(path.join(packageRoot(name), "current.json"), "utf8"); }
  catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
  return componentPackageResponseSchema.parse(JSON.parse(text));
}

const activations = new Map<string, Promise<void>>();

async function activateRelease(release: ComponentPackageResponse, files: ReadonlyMap<string, Uint8Array>) {
  const root = packageRoot(release.name);
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(path.join(root, ".stage-"));
  try {
    const assets = path.join(stage, "assets");
    for (const [name, bytes] of files) {
      const file = path.join(assets, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
    }
    try { await rename(assets, componentPackageArtifactDirectory(release.name, release.digest)); }
    catch (error) {
      const { code } = error as { code?: string };
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
    const pointer = path.join(stage, "current.json");
    await writeFile(pointer, JSON.stringify(release) + "\n");
    await rename(pointer, path.join(root, "current.json"));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function requireCompatibleComponentPackage(
  previous: ComponentPackageResponse | null, release: ComponentPackageResponse,
  caller: Parameters<CheckComponentPackageUpgrade>[2], checkUpgrade?: CheckComponentPackageUpgrade,
) {
  if (!previous || previous.digest === release.digest) return;
  if (!checkUpgrade)
    throw new HttpError(503, "Component package upgrade requires current usage of the installed declarations", "COMPONENT_PACKAGE_USAGE_UNAVAILABLE");
  const changes = await checkUpgrade(previous, release, caller);
  if (!changes.length) return;
  const rejected = componentPackageUpgradeErrorSchema.parse({
    success: false,
    code: COMPONENT_PACKAGE_INCOMPATIBLE,
    error: caller.diagnosticsScope === "deployment"
      ? `Package '${release.name}' is incompatible with existing uses. This deployment-level check lists all affected projections and panels.`
      : `Package '${release.name}' is incompatible with existing uses`,
    details: { package: release.name, scope: caller.diagnosticsScope ?? "domain", changes },
  });
  throw new HttpError(409, rejected.error, rejected.code, rejected.details);
}

/** Check the installed version that this activation actually replaces. */
export async function installComponentPackage(
  release: ComponentPackageResponse, files: ReadonlyMap<string, Uint8Array>,
  caller: Parameters<CheckComponentPackageUpgrade>[2], checkUpgrade?: CheckComponentPackageUpgrade,
) {
  const previousActivation = activations.get(release.name) ?? Promise.resolve();
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const tail = previousActivation.then(() => done);
  activations.set(release.name, tail);
  await previousActivation;
  try {
    const previous = await readComponentPackage(release.name);
    if (previous?.digest === release.digest) return previous;
    await requireCompatibleComponentPackage(previous, release, caller, checkUpgrade);
    await activateRelease(release, files);
    return release;
  } finally {
    finish();
    if (activations.get(release.name) === tail) activations.delete(release.name);
  }
}
