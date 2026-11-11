import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";

type Condition = Record<string, unknown>;
type SourceFilter = Pick<QuerySubgraph["filters"][number], "id" | "label" | "expression"> &
  Partial<Pick<QuerySubgraph["filters"][number], "targetIds" | "queryId">>;
const object = (value: unknown): value is Condition => !!value && typeof value === "object" && !Array.isArray(value);
const logicalKeys = (value: Condition) => Object.keys(value).filter(key => !(key === "operator" && value[key] === "logic"));

/** Split conjunctions only; a disjunction or negation remains one editable condition. */
function parts(value: Condition): Condition[] {
  if (logicalKeys(value).length === 1) {
    if (object(value.properties)) return parts(value.properties);
    if (Array.isArray(value.and) && value.and.length && value.and.every(object)) return value.and.flatMap(parts);
  }
  return [value];
}

export function scopeConditions(
  graph: { filters: SourceFilter[]; nodes?: QuerySubgraph["nodes"]; edges?: QuerySubgraph["edges"] },
  locale: string,
) {
  const zh = locale.startsWith("zh");
  const valueText = (value: unknown): string => value === null ? (zh ? "空值（NULL）" : "NULL")
    : value === "" ? (zh ? "空字符串" : "an empty string")
    : Array.isArray(value) ? value.map(valueText).join(zh ? "、" : ", ")
    : typeof value === "string" ? (zh ? `“${value}”` : JSON.stringify(value)) : String(value);
  function label(condition: Condition, filter: SourceFilter): string | null {
    if (logicalKeys(condition).length === 1) {
      if (object(condition.properties)) return label(condition.properties, filter);
      for (const key of ["and", "or", "not"] as const) {
        const children = condition[key];
        if (!Array.isArray(children) || !children.length || !children.every(object)) continue;
        if (key === "or") {
          const groups = new Map<string, Condition[]>();
          for (const child of children) {
            const { operator: _operator, value: _value, ...reference } = child;
            const id = JSON.stringify(reference);
            groups.set(id, [...(groups.get(id) ?? []), child]);
          }
          const missing = [...groups.values()].every(group => group.length === 2 &&
            group.some(child => child.value === null && ["is", "is null"].includes(String(child.operator).toLowerCase())) &&
            group.some(child => child.value === "" && child.operator === "="));
          if (missing) {
            const labels = [...groups.values()].map(group => {
              const text = label({ ...group[0], operator: "is", value: null }, filter);
              return text?.replace(zh ? /为空值（NULL）$/ : / is NULL$/, zh ? "未填写（空值或空字符串）" : " is unfilled (NULL or an empty string)");
            });
            if (labels.every(text => text != null)) return labels.join(zh ? "；或 " : "; or ");
          }
        }
        const labels = children.map(child => label(child, filter));
        if (labels.some(text => text === null)) return null;
        const join = key === "or" ? (zh ? "；或 " : "; or ") : (zh ? "；且 " : "; and ");
        return `${key === "not" ? (zh ? "不满足：" : "Not: ") : ""}（${labels.join(join)}）`;
      }
    }
    if (typeof condition.field !== "string") return null;
    const candidates = (graph.nodes ?? []).filter(node => node.kind === "field" && node.attrName === condition.field &&
      (!filter.targetIds || filter.targetIds.includes(node.id)));
    const fields = candidates.filter(node => !condition.variable || (graph.edges ?? []).some(edge =>
      edge.kind === "contains" && edge.target === node.id && (graph.nodes ?? []).some(owner =>
        owner.id === edge.source && owner.kind === "class" && owner.variable === condition.variable &&
        (!filter.queryId || owner.queryId === filter.queryId))));
    // Older graphs used long attribute descriptions as labels; keep the exact field name as their fallback.
    const storedLabel = fields.length === 1 ? fields[0]!.label : "";
    const shortLabel = storedLabel.split(/[，。\n]/, 1)[0]!.trim();
    const field = shortLabel && shortLabel.length <= 30 && !/例如/.test(shortLabel) ? shortLabel : condition.field;
    const name = typeof condition.function === "string" ? `${condition.function}(${field})` : field;
    const operator = String(condition.operator ?? "=").toLowerCase().trim();
    const operators: Record<string, [string, string]> = {
      "=": ["等于", "equals"], "!=": ["不等于", "does not equal"], "<>": ["不等于", "does not equal"],
      ">": ["大于", "is greater than"], ">=": ["大于或等于", "is at least"],
      "<": ["小于", "is less than"], "<=": ["小于或等于", "is at most"],
      "in": ["属于以下取值", "is one of"], "not in": ["不属于以下取值", "is not one of"],
      "like": ["匹配模式", "matches pattern"], "not like": ["不匹配模式", "does not match pattern"],
    };
    if ((operator === "is" && condition.value === null) || operator === "is null")
      return `${name}${zh ? "为空值（NULL）" : " is NULL"}`;
    if ((operator === "is not" && condition.value === null) || operator === "is not null")
      return `${name}${zh ? "不为空值（NULL）" : " is not NULL"}`;
    const words = operators[operator];
    if (!words || !("value" in condition)) return null;
    return `${name} ${words[zh ? 0 : 1]} ${valueText(condition.value)}`;
  }
  const ids = new Set(graph.filters.map(filter => filter.id));
  return graph.filters.flatMap(filter => {
    let condition: unknown;
    try { condition = JSON.parse(filter.expression); } catch { /* Preserve non-JSON provenance unchanged. */ }
    if (!object(condition)) return [{ id: filter.id, label: filter.label, expression: filter.expression }];
    const split = parts(condition);
    const children = split.some(child => label(child, filter) === null) ? [condition] : split;
    return children.map((child, index) => {
      let id = filter.id;
      if (children.length > 1) {
        id = `${filter.id}/condition/${index + 1}`;
        while (ids.has(id)) id += "/";
        ids.add(id);
      }
      return { id, label: label(child, filter) ?? filter.label,
        expression: children.length > 1 ? JSON.stringify(child) : filter.expression };
    });
  });
}
