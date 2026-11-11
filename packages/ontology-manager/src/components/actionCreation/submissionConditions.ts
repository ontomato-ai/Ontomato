import type { MessageKey, TextParams } from "../../i18n";

interface Condition {
  kind?: string;
  className?: string;
  objectParameter?: string;
  from?: string;
  relation?: string;
  field?: string;
  operator?: string;
  value?: unknown;
  description?: string;
  message?: string;
  failureMessage?: string;
}

export function submissionConditionRows(
  conditions: (Condition | null)[],
  text: (key: MessageKey, params?: TextParams) => string,
) {
  return conditions.flatMap((condition) => {
    if (!condition) return [];
    let expression = condition.description || "";
    if (condition.kind === "LINK_EXISTS" && condition.relation) {
      expression = text("actionDefinitionLinkExists", {
        source: condition.from || condition.objectParameter || "?",
        relation: condition.relation,
      });
    } else if (condition.field && condition.operator) {
      const field = [condition.className || condition.objectParameter, condition.field].filter(Boolean).join(".");
      expression = [field, condition.operator, JSON.stringify(condition.value)].filter(part => part !== undefined).join(" ");
    }
    const message = condition.message || condition.failureMessage || "";
    return expression || message ? [{ expression, message }] : [];
  });
}
