export class RuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function missing(): never {
  throw new RuntimeError(404, "NOT_FOUND", "Resource not found");
}
export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
