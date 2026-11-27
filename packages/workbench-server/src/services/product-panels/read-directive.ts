const readDirective = Symbol("panelReadDirective");

type ReadDirective = { rereadAfterMs?: number };

export function withReadDirective<T>(value: T, directive: ReadDirective) {
  return { value, [readDirective]: directive };
}

export function unwrapReadDirective(result: unknown): { value: unknown; directive?: ReadDirective } {
  if (result && typeof result === "object" && readDirective in result) {
    const wrapped = result as ReturnType<typeof withReadDirective>;
    return { value: wrapped.value, directive: wrapped[readDirective] };
  }
  return { value: result };
}
