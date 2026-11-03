export type ObjectViewCapabilityReference = { className: string; form?: "full" | "panel"; revision?: number | "published" };
export type ObjectViewCapabilityContract = {
  className: string; form: "full" | "panel"; revision: number; title: string;
  inputs: Record<string, unknown>;
  regions: Array<{ key: string; label: string; kind: string; fields?: string[]; fieldLabels?: Record<string, string>; valueField?: string }>;
  operations: Array<{ key: string; label: string; parameters: Array<{ name: string; type: string; description: string; bound: boolean }>; fieldOptions?: Record<string, Array<{ value: string; label: string }>> }>;
};

/** Supply a host-owned authenticated transport; no credentials or browser storage are managed here. */
export function createObjectViewClient(request: <T>(path: string, body: unknown) => Promise<T>) {
  return {
    contract: (view: ObjectViewCapabilityReference) => request<ObjectViewCapabilityContract>("/objectView/contract", { view }),
    read: (view: ObjectViewCapabilityReference, primaryKey: string, regions: string[], inputs = {}) => request<{ revision: number; regions: Record<string, { success: boolean; value?: unknown; message?: string }> }>("/objectView/instance/read", { view, object: { primaryKey }, regions, inputs }),
    execute: (view: ObjectViewCapabilityReference, primaryKey: string, operation: string, parameters: Record<string, unknown>, inputs = {}) => request<{ revision: number; operation: string; result: unknown }>("/objectView/instance/execute", { view, object: { primaryKey }, operation, parameters, inputs }),
  };
}
