import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { PlatformObjectRefusal } from "./platform-objects";

/*
 * A save writes the target the reader chose, not whichever object the values happen to name. An existing target's
 * values may omit the id or repeat it, but never name another object; a new target's values may not carry an id at all.
 */
export function valuesForTarget(target: PanelFormTarget, values: PanelFormValues): PanelFormValues {
  if (target.kind === "draft") {
    if (Object.hasOwn(values, "id"))
      throw new PlatformObjectRefusal("A new object cannot carry an id", { "/id": "A new object cannot carry an id" });
    return values;
  }
  if (Object.hasOwn(values, "id") && values.id !== target.primaryKey)
    throw new PlatformObjectRefusal("The values name another object", { "/id": "The values name another object" });
  return { ...values, id: target.primaryKey };
}
