import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

function fieldPath(base, key) {
  if (typeof key === "number") return `${base}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function collectIconReferences(value, path, references) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectIconReferences(item, `${path}[${index}]`, references);
    return references;
  }
  if (value === null || typeof value !== "object") return references;
  for (const [key, child] of Object.entries(value)) {
    const childPath = fieldPath(path, key);
    if (key === "icon" && typeof child === "string") references.push({ path: childPath, icon: child });
    if (key === "icons" && child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const [item, icon] of Object.entries(child)) {
        if (typeof icon === "string") references.push({ path: fieldPath(childPath, item), icon });
      }
      continue;
    }
    collectIconReferences(child, childPath, references);
  }
  return references;
}

export function staticPanelIconReferences(config) {
  return collectIconReferences(config, "config", []);
}

export function builtinPanelIconReport({ root, hasAppIcon }) {
  const violations = [];
  let panels = 0;
  const packages = join(root, "packages");
  if (!existsSync(packages)) return { panels, violations };
  for (const owner of readdirSync(packages, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue;
    const absoluteRoot = join(packages, owner.name, "resources/builtin-panels");
    if (!existsSync(absoluteRoot)) continue;
    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(absoluteRoot, entry.name, "panel.json");
      if (!existsSync(file)) continue;
      panels += 1;
      const document = JSON.parse(readFileSync(file, "utf8"));
      for (const [member, declaration] of Object.entries(document.manifest?.members ?? {})) {
        if (declaration.config === undefined) continue;
        for (const { path, icon } of staticPanelIconReferences(declaration.config)) {
          if (!hasAppIcon(icon)) {
            violations.push(`${relative(root, file)}: member ${member} ${path} '${icon}' is not in the platform icon set`);
          }
        }
      }
    }
  }
  return { panels, violations };
}
