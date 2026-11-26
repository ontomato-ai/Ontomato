import type { WorkbenchIdentity } from "./types";

let installed: WorkbenchIdentity | null = null;

export function installWorkbenchIdentity(identity: WorkbenchIdentity): void {
  installed = identity;
}

export function workbenchIdentity(): WorkbenchIdentity {
  if (!installed) throw new Error("Workbench identity is not installed");
  return installed;
}
