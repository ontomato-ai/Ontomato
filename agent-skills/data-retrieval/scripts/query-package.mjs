import { readFile, lstat } from "node:fs/promises";
import path from "node:path";

export function packagePath(name) {
  if (typeof name !== "string" || !name || name.startsWith("/") || /[\\:]/.test(name) ||
      name.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Expected a package-relative file path: " + name);
  return name;
}
async function source(root, name) {
  packagePath(name);
  let target = root;
  for (const part of name.split("/")) {
    target = path.join(target, part);
    const stat = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      throw new Error(`Package file ${name} not found at ${path.join(root, name)}; paths are relative to the manifest's directory`);
    });
    if (stat.isSymbolicLink()) throw new Error("Package links are not allowed: " + name);
  }
  if (!(await lstat(target)).isFile()) throw new Error("Expected a package file: " + name);
  return { path: name, content: await readFile(target, "utf8") };
}
/** Collect only explicitly declared source files; never include exploration output. */
export async function collectPackage(filename) {
  const absolute = path.resolve(filename.replace(/^@/, ""));
  if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Package links are not allowed");
  const text = await readFile(absolute, "utf8"), value = JSON.parse(text);
  if (value.schema !== "ontomato.query-package.v1") {
    if (!value.answer?.steps) throw new Error("Expected an ontology DSL or query-package manifest");
    return dslPackage(text);
  }
  const manifest = value;
  const paths = [...Object.values(manifest.queries), ...manifest.modules,
    ...(manifest.entry.kind === "python" ? [manifest.entry.path] : [])];
  if (new Set(paths).size !== paths.length) throw new Error("Duplicate package paths");
  const files = await Promise.all(paths.map((name) => source(path.dirname(absolute), name)));
  return { manifest, files };
}

function dslPackage(text) {
  return { manifest: {
    schema: "ontomato.query-package.v1", entry: { kind: "dsl", query: "main" },
    queries: { main: "query.json" }, modules: [], parameterDefs: [], parameterBindings: [], computation: null,
  }, files: [{ path: "query.json", content: text }] };
}

/** Build aggregate-only output for a single resolved related object. Java authorizes the DSL. */
export function relatedCountPackage(spec, schema) {
  for (const key of ["objectClass", "objectKey", "relatedClass", "relatedKey", "relationship"]) {
    if (typeof spec?.[key] !== "string" || !spec[key].trim()) throw new Error(`${key} must be a nonempty string`);
  }
  if (typeof spec.value !== "string" && !Number.isFinite(spec.value)) throw new Error("value must be a string or number");
  if (spec.groupField !== undefined && (typeof spec.groupField !== "string" || !spec.groupField.trim())) {
    throw new Error("groupField must be a nonempty string when supplied");
  }
  const relationship = schema.relationships?.find(item => item.name === spec.relationship);
  const forward = relationship?.fromclass === spec.objectClass && relationship?.toclass === spec.relatedClass;
  const reverse = relationship?.fromclass === spec.relatedClass && relationship?.toclass === spec.objectClass;
  if (!forward && !reverse) throw new Error("The relationship must connect objectClass (objects counted) and relatedClass (object filtered)");
  const objects = schema.classes?.find(item => item.className === spec.objectClass);
  const related = schema.classes?.find(item => item.className === spec.relatedClass);
  if (!objects?.attrs?.some(field => field.name === spec.objectKey && field.primaryKey === true)) {
    throw new Error("objectKey must be the primary key of objectClass (the objects counted)");
  }
  if (!related?.attrs?.some(field => field.name === spec.relatedKey && field.primaryKey === true)) {
    throw new Error("relatedKey must be the primary key of relatedClass (the object filtered)");
  }
  if (spec.groupField && !objects.attrs.some(field => field.name === spec.groupField)) {
    throw new Error("groupField must belong to objectClass (the objects counted)");
  }
  const filters = spec.filters ?? [];
  if (!Array.isArray(filters)) throw new Error("filters must be an array");
  const coverageField = spec.coverageField;
  if (coverageField !== undefined && (typeof coverageField !== "string" || spec.groupField !== undefined ||
      !objects.attrs.some(field => field.name === coverageField && ["date", "datetime", "timestamp"].includes(field.type)))) {
    throw new Error("coverageField must be a date/time attribute of objectClass and cannot be combined with groupField");
  }
  if (coverageField !== undefined && filters.some(filter => filter?.field === coverageField)) {
    throw new Error("Keep the coverage field out of filters so missing values remain in scope");
  }
  for (const filter of filters) {
    if (!filter || !objects.attrs.some(field => field.name === filter.field) ||
        !["=", "!=", ">", ">=", "<", "<=", "in", "like"].includes(filter.operator) ||
        !Object.hasOwn(filter, "value") || filter.value === null ||
        (filter.operator === "in" && (!Array.isArray(filter.value) || !filter.value.length)))
      throw new Error("Each filter requires an enabled object field, a supported operator and a non-null value");
  }
  const key = { as: "object_key", variable: "o", field: spec.objectKey, distinct: true };
  const group = { as: "category", variable: "o", field: spec.groupField };
  const checkField = { as: "required_value", variable: "o", field: coverageField };
  const temporary = "/related_count_input";
  const groupColumn = { variable: "t", field: "category" };
  const input = {
    graph: { patterns: [{ objects: [
      { idx: forward ? 0 : 1, variable: "o", class: spec.objectClass, ...(spec.groupField ? { fields: [spec.groupField] } : {}),
        ...(filters.length ? { conditions: { properties: { operator: "logic", and: filters } } } : {}) },
      { idx: forward ? 1 : 0, variable: "r", class: spec.relatedClass, conditions: {
        properties: { field: spec.relatedKey, operator: "=", value: spec.value },
      } },
    ], relationship: [{ from: forward ? 0 : 1, to: forward ? 1 : 0, type: [spec.relationship], min_hops: 1, max_hops: 1 }] }], pattern_logic: "and" },
    output: { to_user: false, save_table: temporary, fields: coverageField ? [key, checkField] : spec.groupField ? [key, group] : [key] },
  };
  const count = { as: "headcount", variable: "t", field: "object_key", function: "count" };
  const output = {
    graph: { patterns: [{ objects: [{ idx: 0, variable: "t", class: temporary }] }], pattern_logic: "and" },
    output: { to_user: true, fields: coverageField
      ? [{ ...count, as: "scope_count" }, { ...count, as: "known_count", field: "required_value" }]
      : spec.groupField ? [{ as: "category", ...groupColumn }, count] : [count],
      ...(spec.groupField ? { group_by: { fields: [groupColumn], having: [] } } : {}) },
  };
  const problem = coverageField ? "Count related objects and non-null dates in the selected scope" : "Count distinct objects associated with the selected object";
  return dslPackage(JSON.stringify({ problem, answer: { steps: [input, output] } }));
}

/** Resolve by an enabled exact-value field; selection and count remain Java-authorized reads. */
export function relatedEntityQuery(spec, schema) {
  const related = schema.classes?.find(item => item.className === spec.relatedClass);
  if (!related?.attrs?.some(field => field.name === spec.relatedKey && field.primaryKey === true) ||
      !related.attrs.some(field => field.name === spec.matchField) || typeof spec.matchValue !== "string" || !spec.matchValue.trim())
    throw new Error("Exact entity resolution requires a related primary key, enabled matchField and nonempty matchValue");
  return { answer: { steps: [{ graph: { patterns: [{ objects: [{ idx: 0, variable: "r", class: spec.relatedClass,
    conditions: { properties: { field: spec.matchField, operator: "=", value: spec.matchValue } },
  }] }], pattern_logic: "and" }, output: { to_user: true, fields: [{ variable: "r", field: spec.relatedKey, as: "entity_key", distinct: true }], limit: { count: 2, offset: 0 } } }] } };
}

export function uniqueRelatedKey(result) {
  if (result.error || result.truncated || result.truncation || !Array.isArray(result.data) || result.data.length !== 1)
    throw new Error("Entity resolution did not return a complete table");
  const table = result.data[0];
  if (table.truncated || table.truncation || !Array.isArray(table.answer) || table.answer.length !== 1 || table.answer[0].entity_key == null)
    throw new Error("Exact entity must resolve to exactly one visible primary key; refine the entity scope");
  return table.answer[0].entity_key;
}
