import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildInfo } from "@ontomato/contracts/health";
import { runtimeRoot } from "./layout";

export function readBuildInfo(): BuildInfo {
  const file = join(runtimeRoot(), "build-info.json");
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")) as BuildInfo
    : { version: "local-build", sources: [] };
}
