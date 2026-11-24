import { panelFormObjectActiveFields, panelFormObjectAllFields, type PanelFormField, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import { panelSecretPathsOverlap } from "@ontomato/contracts/panel-secrets";
import { valueAt } from "../panel/form-values";

/** Lists the declared secret pointers in the draft or in the subtree an agent is trying to replace. */
export function formSecretPaths(
  fields: readonly PanelFormField[],
  values: PanelFormValues,
  { active = false, target }: { active?: boolean; target?: string } = {},
  base = "",
): string[] {
  return fields.flatMap(({ path, control }) => {
    const at = base + path;
    if (target !== undefined && !panelSecretPathsOverlap(at, target)) return [];
    if (control.kind === "text" && control.secret) return [at];
    const current = valueAt(values, at);
    if (control.kind === "object") {
      if (active && (current === null || typeof current !== "object" || Array.isArray(current))) return [];
      const children = active ? panelFormObjectActiveFields(control, current) : panelFormObjectAllFields(control);
      return formSecretPaths(children, values, { active, target }, at);
    }
    if (control.kind === "object-array") {
      const indices = target === undefined
        ? (Array.isArray(current) ? current.map((_, index) => String(index)) : [])
        : [target.startsWith(`${at}/`) ? target.slice(at.length + 1).split("/")[0]! : "0"];
      return indices.flatMap(index => formSecretPaths(control.itemFields, values, { active, target }, `${at}/${index}`));
    }
    return [];
  });
}
